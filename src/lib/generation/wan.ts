import { spawn } from "node:child_process";
import path from "node:path";
import type {
  CreateGenerationInput,
  ProviderJob,
  ProviderResult,
  VideoGenerationProvider,
} from "./provider";
import { env } from "@/lib/config/env";
import { AppError, ERROR_CODES } from "@/lib/errors";

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
        const message =
          (parsed as { errorMsg?: string; message?: string } | null)?.errorMsg ||
          (parsed as { message?: string } | null)?.message ||
          stderr.trim() ||
          text ||
          `Wan CLI exited ${code}`;
        reject(new AppError(ERROR_CODES.GENERATION_FAILED, 502, message));
        return;
      }
      resolve(parsed);
    });
  });
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

export class WanProvider implements VideoGenerationProvider {
  readonly name = "wan";

  async createGeneration(input: CreateGenerationInput): Promise<ProviderJob> {
    const settings = input.settings ?? {};
    const duration = typeof settings.duration === "number" ? settings.duration : 15;
    const ratio = settings.aspectRatio || "16:9";
    const args = [
      "omni2video",
      "--prompt",
      input.prompt,
      "--duration",
      String(duration),
      "--resolution",
      "720P",
      "--ratio",
      ratio,
    ];
    const images = [
      ...(input.referenceImages ?? []),
      ...(input.omniAssets ?? []).filter((asset) => asset.type === "image").map((asset) => asset.url),
    ];
    const videos = [
      ...(input.referenceVideoUrl ? [input.referenceVideoUrl] : []),
      ...(input.omniAssets ?? []).filter((asset) => asset.type === "video").map((asset) => asset.url),
    ];
    if (images.length) args.push("--images", images.join(","));
    if (videos.length) args.push("--videos", videos.join(","));

    const data = (await runWan(args)) as { taskId?: string };
    if (!data?.taskId) {
      throw new AppError(ERROR_CODES.GENERATION_FAILED, 502, "Wan CLI did not return a task id.");
    }
    return { id: data.taskId, status: "queued", progress: 0 };
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
      result?: { videoUrl?: string; url?: string; resourceUrl?: string };
    };
    if (data.statusLabel !== "succeeded") return null;
    const videoUrl = data.result?.videoUrl || data.result?.url || data.result?.resourceUrl;
    if (!videoUrl) return null;
    return { videoUrl, thumbnailUrl: null };
  }
}

export const wanProvider = new WanProvider();
