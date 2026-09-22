import type {
  CreateGenerationInput,
  ProviderJob,
  ProviderResult,
  VideoGenerationProvider,
} from "./provider";
import { env } from "@/lib/config/env";
import { AppError, ERROR_CODES } from "@/lib/errors";

/** Extract the WorkspaceId embedded in a wan-sk.WORKSPACEID.key style API key. */
function workspaceId(apiKey: string): string {
  const parts = apiKey.split(".");
  if (parts.length >= 2 && parts[1]) return parts[1];
  return "";
}

function baseUrl(): string {
  const ws = workspaceId(env.wanApiKey);
  const region = env.wanRegion || "ap-southeast-1";
  return `https://${ws}.${region}.maas.aliyuncs.com/api/v1`;
}

function mapStatus(taskStatus: string): ProviderJob["status"] {
  switch (taskStatus) {
    case "SUCCEEDED": return "complete";
    case "FAILED":
    case "CANCELED": return "failed";
    case "RUNNING": return "generating";
    default: return "queued";
  }
}

export class WanProvider implements VideoGenerationProvider {
  readonly name = "wan";

  async createGeneration(input: CreateGenerationInput): Promise<ProviderJob> {
    const apiKey = env.wanApiKey;
    if (!apiKey) throw new AppError(ERROR_CODES.INTERNAL, 500, "WAN_API_KEY not configured.");

    const media: Array<{ type: string; url: string }> = [];

    for (const img of input.referenceImages ?? []) {
      media.push({ type: "reference_image", url: img });
    }
    if (input.referenceVideoUrl) {
      media.push({ type: "reference_video", url: input.referenceVideoUrl });
    }
    for (const asset of input.omniAssets ?? []) {
      const t =
        asset.type === "image"
          ? "reference_image"
          : asset.type === "video"
            ? "reference_video"
            : "reference_audio";
      media.push({ type: t, url: asset.url });
    }
    if (input.firstFrameImage) {
      media.push({ type: "first_frame", url: input.firstFrameImage });
    }
    if (input.lastFrameImage) {
      media.push({ type: "last_frame", url: input.lastFrameImage });
    }

    const settings = input.settings ?? {};
    const resolution = settings.quality === "high" ? "1920*1080" : "1280*720";
    const duration = typeof settings.duration === "number" ? settings.duration : 15;

    const body = {
      model: "wan3.0-video",
      input: {
        prompt: input.prompt,
        ...(media.length > 0 ? { media } : {}),
      },
      parameters: {
        size: resolution,
        duration,
        prompt_extend: true,
      },
    };

    const res = await fetch(
      `${baseUrl()}/services/aigc/video-generation/video-synthesis`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-DashScope-Async": "enable",
        },
        body: JSON.stringify(body),
      },
    );

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        (data as { message?: string }).message ?? `Wan API error ${res.status}`;
      throw new AppError(ERROR_CODES.PROVIDER_ERROR, 502, msg);
    }

    const taskId = (data.output as { task_id?: string } | undefined)?.task_id;
    if (!taskId) {
      throw new AppError(ERROR_CODES.INTERNAL, 502, "Wan API returned no task_id.");
    }

    return { id: taskId, status: "queued", progress: 0 };
  }

  async getGenerationStatus(providerJobId: string): Promise<ProviderJob> {
    const apiKey = env.wanApiKey;
    const res = await fetch(`${baseUrl()}/tasks/${providerJobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = (await res.json().catch(() => ({}))) as {
      output?: { task_status?: string; message?: string };
    };
    if (!res.ok) throw new AppError(ERROR_CODES.INTERNAL, 502, "Wan status check failed.");

    const ts = data.output?.task_status ?? "PENDING";
    const status = mapStatus(ts);
    const progress =
      status === "complete" ? 100 : status === "generating" ? 50 : 0;
    return {
      id: providerJobId,
      status,
      progress,
      ...(status === "failed" ? { error: data.output?.message } : {}),
    };
  }

  async getResult(providerJobId: string): Promise<ProviderResult | null> {
    const apiKey = env.wanApiKey;
    const res = await fetch(`${baseUrl()}/tasks/${providerJobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = (await res.json().catch(() => ({}))) as {
      output?: { task_status?: string; video_url?: string };
    };
    if (!res.ok || data.output?.task_status !== "SUCCEEDED") return null;
    const videoUrl = data.output?.video_url;
    if (!videoUrl) return null;
    return { videoUrl, thumbnailUrl: null };
  }
}

export const wanProvider = new WanProvider();
