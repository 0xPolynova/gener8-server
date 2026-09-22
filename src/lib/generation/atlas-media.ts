import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import ffmpegPath from "ffmpeg-static";
import { AppError, ERROR_CODES } from "@/lib/errors";

export const MAX_REF_SECONDS = 15;
export const KLING_MAX_REF_SECONDS = 10;
export const KLING_MIN_IMAGE = 768;
const cache = new Map<string, string>();

function ffmpegBin() {
  if (!ffmpegPath) {
    throw new AppError(
      ERROR_CODES.INTERNAL,
      500,
      "FFmpeg isn’t available to prepare the reference clip.",
    );
  }
  return ffmpegPath;
}

function transcodeArgs(
  src: string,
  dest: string,
  withAudio: boolean,
  maxSeconds: number,
) {
  const args = [
    "-y",
    "-i",
    src,
    "-t",
    String(maxSeconds),
    "-vf",
    "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=24",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-crf",
    "23",
  ];
  if (withAudio) {
    args.push("-c:a", "aac", "-ac", "2", "-b:a", "128k");
  } else {
    args.push("-an");
  }
  args.push("-movflags", "+faststart", dest);
  return args;
}

function run(bin: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-2000) || `ffmpeg exited ${code}`));
    });
  });
}

async function transcodeReference(input: Buffer, maxSeconds = MAX_REF_SECONDS) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gener8-ref-"));
  const src = path.join(dir, "in.mp4");
  const dest = path.join(dir, "out.mp4");
  try {
    await fs.writeFile(src, input);
    try {
      await run(ffmpegBin(), transcodeArgs(src, dest, true, maxSeconds));
    } catch {
      await run(ffmpegBin(), transcodeArgs(src, dest, false, maxSeconds));
    }
    return await fs.readFile(dest);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function uploadMedia(
  buffer: Buffer,
  apiKey: string,
  filename: string,
  mime: string,
) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: mime }),
    filename,
  );
  const res = await fetch("https://api.atlascloud.ai/api/v1/model/uploadMedia", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const text = await res.text();
  let body: {
    code?: number;
    message?: string;
    msg?: string;
    data?: { download_url?: string };
  } = {};
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    body = { message: text };
  }
  const url = body.data?.download_url;
  if (!res.ok || !url) {
    throw new AppError(
      ERROR_CODES.UPLOAD_FAILED,
      res.status >= 400 ? res.status : 502,
      body.msg || body.message || "Couldn’t upload reference media to Atlas Cloud.",
    );
  }
  return url;
}

export async function prepareReferenceVideo(sourceUrl: string, apiKey: string) {
  const cached = cache.get(sourceUrl);
  if (cached) return cached;

  const download = await fetch(sourceUrl);
  if (!download.ok) {
    throw new AppError(
      ERROR_CODES.GENERATION_FAILED,
      400,
      "Couldn’t download the base clip to send to Atlas Cloud.",
    );
  }
  const original = Buffer.from(await download.arrayBuffer());
  const prepared = await transcodeReference(original);
  const hosted = await uploadMedia(prepared, apiKey, "reference.mp4", "video/mp4");
  cache.set(sourceUrl, hosted);
  cache.set(
    `hash:${createHash("sha1").update(sourceUrl).digest("hex")}`,
    hosted,
  );
  return hosted;
}

export async function prepareReferenceVideoBuffer(
  sourceUrl: string,
  maxSeconds = MAX_REF_SECONDS,
) {
  const embedded = parseDataUrl(sourceUrl);
  if (embedded) return transcodeReference(embedded.buffer, maxSeconds);

  const download = await fetch(sourceUrl);
  if (!download.ok) {
    throw new AppError(
      ERROR_CODES.GENERATION_FAILED,
      400,
      "Couldn’t download the base clip.",
    );
  }
  const original = Buffer.from(await download.arrayBuffer());
  return transcodeReference(original, maxSeconds);
}

export async function prepareReferenceVideoDataUri(sourceUrl: string) {
  const key = `data:${sourceUrl}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const download = await fetch(sourceUrl);
  if (!download.ok) {
    throw new AppError(
      ERROR_CODES.GENERATION_FAILED,
      400,
      "Couldn’t download the base clip.",
    );
  }
  const original = Buffer.from(await download.arrayBuffer());
  const prepared = await transcodeReference(original);
  const uri = `data:video/mp4;base64,${prepared.toString("base64")}`;
  cache.set(key, uri);
  return uri;
}

export async function prepareReferenceImageBuffer(source: string) {
  let mime = "image/jpeg";
  let buffer: Buffer;
  const data = parseDataUrl(source);
  if (data) {
    mime = data.mime || mime;
    buffer = data.buffer;
  } else if (/^https?:\/\//i.test(source)) {
    const download = await fetch(source);
    if (!download.ok) {
      throw new AppError(
        ERROR_CODES.GENERATION_FAILED,
        400,
        "Couldn’t read a reference photo.",
      );
    }
    mime = download.headers.get("content-type")?.split(";")[0] || mime;
    buffer = Buffer.from(await download.arrayBuffer());
  } else {
    throw new AppError(
      ERROR_CODES.GENERATION_FAILED,
      400,
      "Reference photos must be image files.",
    );
  }

  const ext = mime.includes("png")
    ? "png"
    : mime.includes("webp")
      ? "webp"
      : mime.includes("gif")
        ? "gif"
        : "jpg";
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gener8-img-"));
  const src = path.join(dir, `in.${ext}`);
  const dest = path.join(dir, "out.jpg");
  try {
    await fs.writeFile(src, buffer);
    await run(ffmpegBin(), [
      "-y",
      "-i",
      src,
      "-vf",
      `scale=${KLING_MIN_IMAGE}:${KLING_MIN_IMAGE}:force_original_aspect_ratio=decrease,pad=${KLING_MIN_IMAGE}:${KLING_MIN_IMAGE}:(ow-iw)/2:(oh-ih)/2:color=black`,
      "-q:v",
      "6",
      dest,
    ]);
    return await fs.readFile(dest);
  } catch {
    throw new AppError(
      ERROR_CODES.GENERATION_FAILED,
      400,
      "Couldn’t prepare a reference photo. Use a normal photo file.",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function parseDataUrl(source: string) {
  const match = source.match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

function imageFilename(mime: string) {
  if (mime.includes("png")) return "reference.png";
  if (mime.includes("webp")) return "reference.webp";
  if (mime.includes("gif")) return "reference.gif";
  return "reference.jpg";
}

export async function prepareReferenceImage(source: string, apiKey: string) {
  const key = `img:${createHash("sha1").update(source).digest("hex")}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let mime = "image/jpeg";
  let buffer: Buffer;
  const data = parseDataUrl(source);
  if (data) {
    mime = data.mime || mime;
    buffer = data.buffer;
  } else {
    const download = await fetch(source);
    if (!download.ok) {
      throw new AppError(
        ERROR_CODES.GENERATION_FAILED,
        400,
        "Couldn’t read a reference photo to send to Atlas Cloud.",
      );
    }
    mime = download.headers.get("content-type")?.split(";")[0] || mime;
    buffer = Buffer.from(await download.arrayBuffer());
  }

  const hosted = await uploadMedia(buffer, apiKey, imageFilename(mime), mime);
  cache.set(key, hosted);
  return hosted;
}
