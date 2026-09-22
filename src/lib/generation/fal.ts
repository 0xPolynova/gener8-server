import { env } from "@/lib/config/env";
import { AppError, ERROR_CODES } from "@/lib/errors";
import type { GenerationSettings, GenerationStatus } from "@/types";
import {
  prepareReferenceVideoBuffer,
  prepareReferenceImageBuffer,
  KLING_MAX_REF_SECONDS,
} from "./atlas-media";
import { persistGeneratedVideo, rehostOrKeep } from "./persist";
import { db } from "@/lib/data/repository";
import type {
  CreateGenerationInput,
  ProviderJob,
  ProviderResult,
  VideoGenerationProvider,
} from "./provider";

const QUEUE = "https://queue.fal.run";
const STORAGE_INITIATE = "https://rest.fal.ai/storage/upload/initiate";

type FalStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED";

interface FalQueueSubmit {
  request_id?: string;
  status?: FalStatus;
  error?: string;
  detail?: string | { msg?: string }[];
}

interface FalQueueStatus {
  status?: FalStatus;
  error?: string;
  detail?: string | { msg?: string }[];
}

interface FalResult {
  video?: { url?: string };
  error?: string;
  detail?: string | { msg?: string }[];
}

function falKey() {
  return env.falKey || process.env.FAL_KEY || "";
}

function headers() {
  const key = falKey();
  if (!key) {
    throw new AppError(
      ERROR_CODES.INTERNAL,
      503,
      "fal.ai isn’t configured. Add FAL_KEY to .env and restart the API.",
    );
  }
  return {
    Authorization: `Key ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function falPrompt(prompt: string) {
  return prompt
    .replace(/\[Video(\d+)\]/gi, "@Video$1")
    .replace(/\[Image(\d+)\]/gi, "@Image$1");
}

function klingPrompt(prompt: string) {
  return falPrompt(prompt).replace(/@Element(\d+)/gi, "@Image$1");
}

function isKlingModel(model: string) {
  return model.includes("kling");
}

function clampDuration(wanted: number) {
  if (wanted < 4) return 4;
  if (wanted > 30) return 30;
  return Math.round(wanted);
}

function pickResolution(quality: GenerationSettings["quality"]) {
  return quality === "high" ? "720p" : "480p";
}

function pickRatio(aspect: string) {
  if (
    aspect === "16:9" ||
    aspect === "9:16" ||
    aspect === "1:1" ||
    aspect === "4:3"
  ) {
    return aspect;
  }
  return "16:9";
}

function errorText(payload: unknown, fallback: string) {
  if (!payload) return fallback;
  if (typeof payload === "string" && payload.trim()) return payload;
  if (typeof payload !== "object") return fallback;
  const body = payload as FalQueueSubmit & FalResult & {
    body?: { detail?: unknown };
  };
  if (typeof body.error === "string" && body.error) return body.error;
  const detail = body.detail ?? body.body?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const row = item as { loc?: unknown; msg?: string };
        const where = Array.isArray(row.loc) ? row.loc.slice(1).join(".") : "";
        const msg = typeof row.msg === "string" ? row.msg : "";
        return [where, msg].filter(Boolean).join(": ");
      })
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  return fallback;
}

function encodeJobId(model: string, requestId: string) {
  return `${model}::${requestId}`;
}

function decodeJobId(providerJobId: string) {
  const split = providerJobId.indexOf("::");
  if (split === -1) {
    return { model: env.falModelRef, requestId: providerJobId };
  }
  return {
    model: providerJobId.slice(0, split),
    requestId: providerJobId.slice(split + 2),
  };
}

function mapStatus(status: string | undefined): GenerationStatus {
  switch (status) {
    case "IN_QUEUE":
      return "queued";
    case "IN_PROGRESS":
      return "generating";
    case "COMPLETED":
      return "complete";
    default:
      return "failed";
  }
}

function mapProgress(status: string | undefined) {
  switch (status) {
    case "IN_QUEUE":
      return 12;
    case "IN_PROGRESS":
      return 55;
    case "COMPLETED":
      return 100;
    default:
      return 0;
  }
}

async function request<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ status: number; body: T }> {
  const { timeoutMs = 60_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...rest,
      headers: { ...headers(), ...(rest.headers ?? {}) },
      signal: controller.signal,
    });
    const text = await res.text();
    let body: T = {} as T;
    if (text) {
      try {
        body = JSON.parse(text) as T;
      } catch {
        body = { error: text } as T;
      }
    }
    return { status: res.status, body };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      ERROR_CODES.PROVIDER_TIMEOUT,
      504,
      "fal.ai didn’t respond. Try again in a moment.",
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function uploadToFal(buffer: Buffer, filename: string, mime: string) {
  const { status, body } = await request<{
    upload_url?: string;
    file_url?: string;
    url?: string;
  }>(STORAGE_INITIATE, {
    method: "POST",
    body: JSON.stringify({ file_name: filename, content_type: mime }),
  });
  const uploadUrl = body.upload_url;
  const fileUrl = body.file_url || body.url;
  if (status >= 400 || !uploadUrl || !fileUrl) {
    throw new Error(errorText(body, "fal storage initiate failed"));
  }
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mime },
    body: new Uint8Array(buffer),
  });
  if (!put.ok) {
    throw new Error(`fal storage upload failed (${put.status})`);
  }
  return fileUrl;
}

async function hostFile(buffer: Buffer, filename: string, mime: string) {
  try {
    return await uploadToFal(buffer, filename, mime);
  } catch (error) {
    console.warn("[fal] storage upload failed, using app storage", error);
    if (mime.startsWith("video/")) {
      return persistGeneratedVideo(filename.replace(/[^a-zA-Z0-9._-]/g, "_"), buffer);
    }
    const key = `refs/${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const uploaded = await db.uploadGeneratedVideo(key, buffer);
    if (!uploaded) {
      throw error instanceof Error ? error : new Error("Couldn’t host reference media");
    }
    return uploaded;
  }
}

async function hostImage(source: string, index: number) {
  const buffer = await prepareReferenceImageBuffer(source);
  return hostFile(buffer, `person-${index}.jpg`, "image/jpeg");
}

export class FalVideoProvider implements VideoGenerationProvider {
  readonly name = "fal";
  private results = new Map<string, ProviderResult>();

  async createGeneration(input: CreateGenerationInput): Promise<ProviderJob> {
    const images = (input.referenceImages ?? []).filter(Boolean);
    const hasRefs = Boolean(input.referenceVideoUrl) || images.length > 0;
    const model = hasRefs ? env.falModelRef : env.falModelT2v;
    const hostedImages = images.length
      ? await Promise.all(images.map((image, index) => hostImage(image, index + 1)))
      : [];

    let payload: Record<string, unknown>;
    if (hasRefs && isKlingModel(model)) {
      if (!input.referenceVideoUrl) {
        throw new AppError(
          ERROR_CODES.GENERATION_FAILED,
          400,
          "Kling character swap needs the Hotel Lobby base clip.",
        );
      }
      const clip = await prepareReferenceVideoBuffer(
        input.referenceVideoUrl,
        KLING_MAX_REF_SECONDS,
      );
      payload = {
        prompt: klingPrompt(input.prompt),
        video_url: await hostFile(clip, "reference.mp4", "video/mp4"),
        keep_audio: true,
        image_urls: hostedImages.slice(0, 3),
      };
    } else {
      const settings = input.settings;
      payload = {
        prompt: falPrompt(input.prompt),
        duration: String(clampDuration(settings.duration ?? 5)),
        resolution: pickResolution(settings.quality),
        aspect_ratio: hasRefs ? "auto" : pickRatio(settings.aspectRatio),
        generate_audio: true,
        bitrate_mode: "standard",
      };
      if (hasRefs) payload.task = "reference";
      if (typeof settings.seed === "number" && settings.seed >= 0) {
        payload.seed = settings.seed;
      }
      if (hasRefs) {
        if (input.referenceVideoUrl) {
          const clip = await prepareReferenceVideoBuffer(input.referenceVideoUrl);
          payload.video_urls = [
            await hostFile(clip, "reference.mp4", "video/mp4"),
          ];
        }
        if (hostedImages.length) payload.image_urls = hostedImages;
      }
    }

    console.info("[fal] submit", {
      model,
      promptChars: String(payload.prompt ?? "").length,
      hasVideo: Boolean(
        payload.video_url ||
          (Array.isArray(payload.video_urls) && payload.video_urls.length),
      ),
      images: Array.isArray(payload.image_urls) ? payload.image_urls.length : 0,
    });
    const { status, body } = await request<FalQueueSubmit>(
      `${QUEUE}/${model}`,
      { method: "POST", body: JSON.stringify(payload) },
    );
    const id = body.request_id;
    if (status >= 400 || !id) {
      const message = errorText(body, "fal.ai rejected the generation request.");
      console.error("[fal] generateVideo failed", status, message);
      throw new AppError(
        ERROR_CODES.GENERATION_FAILED,
        status >= 400 ? status : 502,
        message,
      );
    }

    return {
      id: encodeJobId(model, id),
      status: mapStatus(body.status ?? "IN_QUEUE"),
      progress: mapProgress(body.status ?? "IN_QUEUE"),
    };
  }

  async getGenerationStatus(providerJobId: string): Promise<ProviderJob> {
    const { model, requestId } = decodeJobId(providerJobId);
    let status: number;
    let body: FalQueueStatus;
    try {
      ({ status, body } = await request<FalQueueStatus>(
        `${QUEUE}/${model}/requests/${encodeURIComponent(requestId)}/status`,
        { method: "GET", timeoutMs: 30_000 },
      ));
    } catch {
      return { id: providerJobId, status: "generating", progress: 55 };
    }
    if (status === 429 || status >= 500) {
      return { id: providerJobId, status: "generating", progress: 55 };
    }
    if (status >= 400) {
      return {
        id: providerJobId,
        status: "failed",
        progress: 0,
        error: errorText(body, "Couldn’t check generation status."),
      };
    }
    const mapped = mapStatus(body.status);
    if (mapped === "complete") {
      const result = await request<FalResult>(
        `${QUEUE}/${model}/requests/${encodeURIComponent(requestId)}`,
        { method: "GET", timeoutMs: 15_000 },
      ).catch(() => null);
      if (!result || result.status >= 400 || !result.body.video?.url) {
        return {
          id: providerJobId,
          status: "failed",
          progress: 0,
          error: errorText(
            result?.body ?? body,
            "fal.ai rejected the input. Try generating again.",
          ),
        };
      }
    }
    if (mapped === "failed") {
      const result = await request<FalResult>(
        `${QUEUE}/${model}/requests/${encodeURIComponent(requestId)}`,
        { method: "GET", timeoutMs: 15_000 },
      ).catch(() => null);
      return {
        id: providerJobId,
        status: "failed",
        progress: 0,
        error: errorText(
          result?.body ?? body,
          "Generation failed. Try regenerating.",
        ),
      };
    }
    return {
      id: providerJobId,
      status: mapped,
      progress: mapProgress(body.status),
    };
  }

  async getResult(providerJobId: string): Promise<ProviderResult | null> {
    const cached = this.results.get(providerJobId);
    if (cached) return cached;
    const { model, requestId } = decodeJobId(providerJobId);
    const { status, body } = await request<FalResult>(
      `${QUEUE}/${model}/requests/${encodeURIComponent(requestId)}`,
      { method: "GET", timeoutMs: 30_000 },
    );
    if (status >= 400) return null;
    const remote = body.video?.url;
    if (!remote) return null;
    const result = await rehostOrKeep(requestId, remote);
    this.results.set(providerJobId, result);
    return result;
  }
}

const globalProvider = globalThis as unknown as {
  __gener8Fal?: FalVideoProvider;
};

export const falProvider = globalProvider.__gener8Fal ?? new FalVideoProvider();
if (!globalProvider.__gener8Fal) {
  globalProvider.__gener8Fal = falProvider;
}
