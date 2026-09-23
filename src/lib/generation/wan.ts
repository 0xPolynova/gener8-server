import { spawn } from "node:child_process";
import fs from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import type {
  CreateGenerationInput,
  ProviderJob,
  ProviderResult,
  VideoGenerationProvider,
} from "./provider";
import { env } from "@/lib/config/env";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { logger } from "@/lib/log";
import { persistGeneratedClip } from "./persist";

function cliEntry() {
  return path.join(process.cwd(), "node_modules", "@wan-ai", "cli", "dist", "index.js");
}

function runWan(args: string[]): Promise<unknown> {
  const apiKey = env.wanApiKey;
  if (!apiKey) throw new AppError(ERROR_CODES.INTERNAL, 500, "WAN_API_KEY not configured.");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry(), ...args, "--site", "intl", "--output", "json"], {
      env: { ...process.env, WAN_ACCESS_KEY: apiKey },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const text = stdout.trim();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }
      if (code !== 0) {
        const body = parsed as {
          errorMsg?: string;
          message?: string;
          details?: { actual?: unknown };
        } | null;
        const actual = body?.details?.actual;
        const message = [
          body?.errorMsg || body?.message || stderr.trim() || text || `Wan CLI exited ${code}`,
          actual ? JSON.stringify(actual) : "",
        ]
          .filter(Boolean)
          .join(" ");
        reject(new AppError(ERROR_CODES.GENERATION_FAILED, 502, message));
        return;
      }
      resolve(parsed);
    });
  });
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".mov"]);

/** Wan's API cannot fetch loopback uploads, so pass the file on disk. */
function localUpload(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return null;
  if (!parsed.pathname.startsWith("/uploads/")) return null;
  const name = path.basename(parsed.pathname);
  if (!name || name === "." || name === "..") return null;
  const file = path.join(process.cwd(), "uploads", name);
  return fs.existsSync(file) ? file : null;
}

function sniffExt(bytes: Buffer, kind: "image" | "video") {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return ".jpg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return ".png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return ".webp";
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") return ".mp4";
  return kind === "video" ? ".mp4" : ".jpg";
}

function isDirectMp4(url: string) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".mp4");
  } catch {
    return false;
  }
}

function isStreamUrl(url: string) {
  try {
    const host = new URL(url).hostname;
    return host.endsWith("cloudflarestream.com") || host.endsWith("videodelivery.net");
  } catch {
    return false;
  }
}

function streamSource(url: string) {
  const parsed = new URL(url);
  const uid = parsed.pathname.split("/").filter(Boolean)[0];
  if (parsed.pathname.includes("/downloads/") && parsed.pathname.endsWith(".mp4")) return url;
  if (parsed.pathname.includes("/manifest/") || parsed.pathname.endsWith(".m3u8")) return url;
  return uid ? `${parsed.origin}/${uid}/manifest/video.m3u8` : url;
}

function ffmpegFailure(stderr: string) {
  const line = stderr
    .split("\n")
    .map((item) => item.trim())
    .reverse()
    .find((item) => /error|invalid|http|404|403|fail/i.test(item) && !item.startsWith("--enable"));
  return line?.slice(0, 240) || "Couldn't read the reference video.";
}

function runFfmpeg(args: string[]) {
  const bin = ffmpegPath;
  if (!bin) {
    return Promise.reject(new AppError(ERROR_CODES.GENERATION_FAILED, 502, "Couldn't read the reference video."));
  }
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new AppError(ERROR_CODES.GENERATION_FAILED, 502, ffmpegFailure(stderr)));
    });
  });
}

/** CDN MP4 when Cloudflare has one. Otherwise copy the stream into a file, without re-encoding. */
async function wanReferenceFile(url: string) {
  const parsed = new URL(url);
  const uid = parsed.pathname.split("/").filter(Boolean)[0];
  const mp4 = !uid
    ? ""
    : parsed.pathname.includes("/downloads/") && parsed.pathname.endsWith(".mp4")
      ? url
      : `${parsed.origin}/${uid}/downloads/default.mp4`;
  if (mp4) {
    const head = await fetch(mp4, { method: "HEAD" });
    if (head.ok) return mp4;
  }
  const file = path.join(os.tmpdir(), `gener8-${Date.now()}-${Math.random().toString(16).slice(2)}.mp4`);
  await runFfmpeg([
    "-y",
    "-t",
    "30",
    "-i",
    streamSource(url),
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    file,
  ]);
  return file;
}

/**
 * Wan rejects remote images whose URL has no extension (Cloudflare `/public`).
 * Hand the CLI a local file it can measure itself.
 */
async function materialize(url: string, kind: "image" | "video") {
  const local = localUpload(url);
  const source = local ?? url;
  const ext = path.extname(source.split(/[?#]/)[0] ?? "").toLowerCase();
  const allowed = kind === "image" ? IMAGE_EXTS : VIDEO_EXTS;
  if (!/^https?:\/\//.test(source) && allowed.has(ext)) return source;

  const response = await fetch(url);
  if (!response.ok) {
    throw new AppError(ERROR_CODES.GENERATION_FAILED, 502, `Couldn't read the reference ${kind}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const file = path.join(os.tmpdir(), `gener8-${Date.now()}-${Math.random().toString(16).slice(2)}${sniffExt(bytes, kind)}`);
  await writeFile(file, bytes);
  return file;
}

function probeDuration(file: string): Promise<number | null> {
  const bin = ffmpegPath;
  if (!bin) return Promise.resolve(null);
  return new Promise((resolve) => {
    const child = spawn(bin, ["-i", file], { windowsHide: true });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) {
        resolve(null);
        return;
      }
      const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      resolve(Number.isFinite(seconds) ? seconds : null);
    });
  });
}

/**
 * Reference and output both follow the source video, up to 30s.
 */
async function referencePlan(files: string[]) {
  const ends: number[] = [];
  for (const file of files) {
    const duration = await probeDuration(file);
    if (duration != null && duration < 1) {
      throw new AppError(
        ERROR_CODES.GENERATION_FAILED,
        502,
        "That reference video on the CDN is shorter than a second, so Wan can't remix it.",
      );
    }
    if (duration == null) return null;
    const end = Math.min(30, Math.floor(duration * 10) / 10);
    if (end < 1) return null;
    ends.push(end);
  }
  return { ranges: ends.map((end) => `0:${end}`).join(",") };
}

function outputDuration(requested: number) {
  const value = Number.isFinite(requested) ? Math.round(requested) : 5;
  return Math.min(Math.max(value, 2), 30);
}

function mapLabel(label: string | undefined): ProviderJob["status"] {
  switch (label) {
    case "succeeded":
      return "complete";
    case "failed":
      return "failed";
    case "running":
      return "generating";
    default:
      return "queued";
  }
}

type WanAsset = {
  url?: string;
  urlWithoutLogo?: string;
  resizeUrlWithoutLogo?: string;
  downloadUrl?: string;
  downloadUrlWithLogo?: string;
  videoFirstFrameUrl?: string;
};

function firstAsset(result: unknown): WanAsset | null {
  const asset = Array.isArray(result) ? result[0] : result;
  if (!asset || typeof asset !== "object") return null;
  return asset as WanAsset;
}

/** Same choice as the Wan site’s download-without-watermark button. Never the logo file. */
function cleanDownloadUrl(asset: WanAsset) {
  const logo = asset.downloadUrlWithLogo;
  const candidates = [asset.urlWithoutLogo, asset.resizeUrlWithoutLogo, asset.downloadUrl];
  return candidates.find((url) => url && url !== logo) || asset.urlWithoutLogo || asset.downloadUrl || null;
}

export class WanProvider implements VideoGenerationProvider {
  readonly name = "wan";

  async createGeneration(input: CreateGenerationInput): Promise<ProviderJob> {
    const settings = input.settings ?? {};
    const ratio = settings.aspectRatio || "16:9";
    const images = await Promise.all(
      [
        ...(input.referenceImages ?? []),
        ...(input.omniAssets ?? []).filter((asset) => asset.type === "image").map((asset) => asset.url),
      ].map((url) => materialize(url, "image")),
    );
    const videos = await Promise.all(
      [
        ...(input.referenceVideoUrl ? [input.referenceVideoUrl] : []),
        ...(input.omniAssets ?? []).filter((asset) => asset.type === "video").map((asset) => asset.url),
      ].map(async (url) => {
        if (isDirectMp4(url)) return url;
        if (!isStreamUrl(url)) return materialize(url, "video");
        return wanReferenceFile(url);
      }),
    );
    const plan = videos.length ? await referencePlan(videos) : null;
    const requested = typeof settings.duration === "number" ? settings.duration : 15;
    const duration = outputDuration(requested);
    if (plan) {
      logger.info("remix duration", { seconds: duration, ranges: plan.ranges });
    }
    const args = [
      "omni2video",
      "--model",
      "wan3.0",
      "--prompt",
      input.prompt,
      "--duration",
      String(duration),
      "--resolution",
      "720P",
      "--ratio",
      ratio,
    ];
    if (images.length) args.push("--images", images.join(","));
    if (videos.length) args.push("--videos", videos.join(","));
    if (plan) args.push("--video-ranges", plan.ranges);

    const data = (await runWan(args)) as { taskId?: string };
    if (!data?.taskId) {
      throw new AppError(ERROR_CODES.GENERATION_FAILED, 502, "Wan CLI did not return a task id.");
    }
    return { id: data.taskId, status: "queued", progress: 0, duration };
  }

  async getGenerationStatus(providerJobId: string): Promise<ProviderJob> {
    const data = (await runWan(["result", "get", providerJobId])) as {
      statusLabel?: string;
      errorMsg?: string;
    };
    const status = mapLabel(data.statusLabel);
    return {
      id: providerJobId,
      status,
      progress: status === "complete" ? 100 : status === "generating" ? 50 : 10,
      ...(status === "failed" && data.errorMsg ? { error: data.errorMsg } : {}),
    };
  }

  async getResult(providerJobId: string): Promise<ProviderResult | null> {
    const data = (await runWan(["result", "get", providerJobId])) as {
      statusLabel?: string;
      result?: unknown;
    };
    if (data.statusLabel !== "succeeded") return null;
    const asset = firstAsset(data.result) ?? {};
    const remoteUrl = cleanDownloadUrl(asset);
    logger.info("wan download", {
      providerJobId,
      clean: Boolean(asset.urlWithoutLogo || (asset.downloadUrl && asset.downloadUrl !== asset.downloadUrlWithLogo)),
    });
    if (!remoteUrl) return null;
    const download = await fetch(remoteUrl);
    if (!download.ok) {
      throw new AppError(
        ERROR_CODES.GENERATION_FAILED,
        502,
        `Couldn't download the finished video (${download.status}).`,
      );
    }
    const hosted = await persistGeneratedClip(providerJobId, Buffer.from(await download.arrayBuffer()));
    return hosted;
  }
}

export const wanProvider = new WanProvider();
