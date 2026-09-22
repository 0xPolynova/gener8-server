import { env } from "@/lib/config/env";
import { db } from "@/lib/data/repository";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { logger, serializeError } from "@/lib/log";
import {
  MAX_REF_SECONDS,
  prepareReferenceImageBuffer,
  prepareReferenceVideoBuffer,
} from "./atlas-media";
import { persistPublicFile, rehostOrKeep } from "./persist";
import type {
  CreateGenerationInput,
  ProviderJob,
  ProviderResult,
  VideoGenerationProvider,
} from "./provider";
import type { GenerationStatus } from "@/types";

const DEFAULT_BASE = "https://api.wavespeed.ai/api/v3";
const DEFAULT_MODEL = "alibaba/wan-3.0/reference-to-video";
const WAN_MAX_OUTPUT = 30;
const WAN_ASPECT = new Set(["16:9", "9:16", "1:1", "4:3", "3:4"]);
const FAIL = new Set(["failed", "cancelled", "timeout", "deleted"]);

type WaveSpeedTask = {
  id?: string;
  status?: string;
  outputs?: unknown[];
  error?: string;
  urls?: { get?: string };
};

function apiKey() {
  return env.wavespeedApiKey || process.env.WAVESPEED_API_KEY || "";
}

function baseUrl() {
  return (env.wavespeedBaseUrl || DEFAULT_BASE).replace(/\/$/, "");
}

function modelId(input?: { referenceModel?: string | null }) {
  if (input?.referenceModel === env.wavespeedModelSeedance) {
    return env.wavespeedModelSeedance;
  }
  return env.wavespeedModelRef || DEFAULT_MODEL;
}

function isSeedance(model: string) {
  return model.includes("seedance");
}

function headers() {
  const key = apiKey();
  if (!key) {
    throw new AppError(
      ERROR_CODES.INTERNAL,
      503,
      "WaveSpeed isn’t configured. Add WAVESPEED_API_KEY to .env and restart the API.",
    );
  }
  return {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
}

function isPublicHttps(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
  } catch {
    return false;
  }
}

function wanPrompt(prompt: string) {
  return prompt
    .replace(/\[Video(\d+)\]/gi, "@Video$1")
    .replace(/\[Image(\d+)\]/gi, "@Image$1")
    .replace(/@Element(\d+)/gi, "@Image$1");
}

function wanDuration(requested: number | undefined, refSeconds: number) {
  const raw = Number.isFinite(requested) ? Number(requested) : 15;
  const maxOut = Math.max(2, WAN_MAX_OUTPUT - refSeconds);
  return Math.min(Math.max(Math.round(raw), 2), maxOut);
}

function wanResolution(_quality?: string) {
  return "720p";
}

function wanAspect(ratio?: string) {
  return ratio && WAN_ASPECT.has(ratio) ? ratio : "16:9";
}

function errorText(payload: unknown, fallback: string) {
  if (!payload) return fallback;
  if (typeof payload === "string" && payload.trim()) return payload;
  if (typeof payload !== "object") return fallback;
  const body = payload as { message?: string; error?: string; data?: { error?: string } };
  return body.data?.error || body.error || body.message || fallback;
}

function outputUrl(outputs?: unknown[]) {
  for (const item of outputs ?? []) {
    if (typeof item === "string" && /^https?:\/\//i.test(item)) return item;
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      for (const key of ["url", "video", "video_url", "file_url", "download_url"]) {
        const value = row[key];
        if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
      }
    }
  }
  return null;
}

function mapStatus(status?: string): GenerationStatus {
  switch (status) {
    case "completed":
    case "complete":
    case "success":
    case "succeed":
    case "succeeded":
      return "complete";
    case "processing":
    case "running":
    case "pending":
      return "generating";
    case "created":
      return "queued";
    default:
      return status && FAIL.has(status) ? "failed" : "queued";
  }
}

function mapProgress(status?: string) {
  switch (status) {
    case "completed":
      return 100;
    case "processing":
      return 55;
    case "created":
      return 12;
    default:
      return status && FAIL.has(status) ? 0 : 12;
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
        body = { message: text } as T;
      }
    }
    if (res.status >= 400) {
      logger.warn("wavespeed http error", {
        status: res.status,
        url,
        message: errorText(body, text.slice(0, 500)),
      });
    }
    return { status: res.status, body };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error("wavespeed request failed", { url, err: serializeError(error) });
    throw new AppError(
      ERROR_CODES.PROVIDER_TIMEOUT,
      504,
      "WaveSpeed didn’t respond. Try again in a moment.",
    );
  } finally {
    clearTimeout(timer);
  }
}

async function uploadBinary(buffer: Buffer, filename: string, mime: string) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: mime }),
    filename,
  );
  const { status, body } = await request<{
    code?: number;
    message?: string;
    data?: { download_url?: string };
  }>(`${baseUrl()}/media/upload/binary`, {
    method: "POST",
    body: form,
    headers: { Authorization: headers().Authorization },
  });
  const url = body.data?.download_url;
  if (status >= 400 || !url || !isPublicHttps(url) || (body.code != null && body.code !== 200)) {
    throw new Error(errorText(body, "WaveSpeed file upload failed."));
  }
  return url;
}

async function hostPublicMedia(
  buffer: Buffer,
  filename: string,
  mime: string,
) {
  try {
    return await uploadBinary(buffer, filename, mime);
  } catch (error) {
    logger.warn("wavespeed upload failed, trying app storage", {
      err: serializeError(error),
    });
    const uploaded = await db.uploadGeneratedVideo(`refs/${filename}`, buffer);
    if (uploaded && isPublicHttps(uploaded)) return uploaded;
    const local = await persistPublicFile(`refs/${filename}`, buffer);
    if (isPublicHttps(local)) return local;
    throw new AppError(
      ERROR_CODES.GENERATION_FAILED,
      502,
      "Couldn’t publish the reference media.",
    );
  }
}

async function hostImage(source: string, index: number) {
  if (isPublicHttps(source)) return source;
  const buffer = await prepareReferenceImageBuffer(source);
  return hostPublicMedia(buffer, `ref-${index}.jpg`, "image/jpeg");
}

export class WaveSpeedVideoProvider implements VideoGenerationProvider {
  readonly name = "wavespeed";
  private results = new Map<string, ProviderResult>();

  async createGeneration(input: CreateGenerationInput): Promise<ProviderJob> {
    if (!input.referenceVideoUrl) {
      throw new AppError(
        ERROR_CODES.GENERATION_FAILED,
        400,
        "A base video is required for this generation.",
      );
    }
    const images = (input.referenceImages ?? []).filter(Boolean);
    const refSeconds = MAX_REF_SECONDS;
    const duration = wanDuration(15, refSeconds);
    const clip = await prepareReferenceVideoBuffer(
      input.referenceVideoUrl,
      refSeconds,
    );
    const video = await hostPublicMedia(clip, "reference.mp4", "video/mp4");
    const hostedImages = await Promise.all(
      images.slice(0, 10).map((image, index) => hostImage(image, index + 1)),
    );

    const model = modelId(input);
    const payload: Record<string, unknown> = {
      prompt: wanPrompt(input.prompt),
      reference_videos: [video],
      resolution: wanResolution(input.settings?.quality),
      aspect_ratio: wanAspect(input.settings?.aspectRatio),
      duration,
    };
    if (isSeedance(model)) {
      payload.generate_audio = true;
    } else {
      payload.enable_audio = true;
    }
    payload.enable_prompt_expansion = false;
    payload.enable_safety_checker = false;
    payload.safety_checker = false;
    if (hostedImages.length) payload.reference_images = hostedImages;
    if (typeof input.settings?.seed === "number" && input.settings.seed >= 0) {
      payload.seed = input.settings.seed;
    }

    logger.info("wavespeed submit", {
      model,
      promptChars: String(payload.prompt).length,
      duration,
      resolution: payload.resolution,
      images: hostedImages.length,
      enable_safety_checker: payload.enable_safety_checker === false,
      enable_prompt_expansion: payload.enable_prompt_expansion === false,
    });

    const submit = (body: Record<string, unknown>) =>
      request<{
        code?: number;
        message?: string;
        data?: WaveSpeedTask;
      }>(`${baseUrl()}/${model}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    const { status, body } = await submit(payload);

    const task = body.data;
    if (status >= 400 || !task?.id || (body.code != null && body.code !== 200)) {
      const message = errorText(body, "WaveSpeed rejected the reference-to-video request.");
      logger.error("wavespeed submit rejected", {
        model,
        status,
        code: body.code,
        message,
      });
      throw new AppError(
        ERROR_CODES.GENERATION_FAILED,
        status >= 400 ? status : 502,
        message,
      );
    }

    return {
      id: task.id,
      status: mapStatus(task.status ?? "created"),
      progress: mapProgress(task.status ?? "created"),
    };
  }

  async getGenerationStatus(providerJobId: string): Promise<ProviderJob> {
    const { status, body } = await request<{
      code?: number;
      message?: string;
      data?: WaveSpeedTask;
    }>(`${baseUrl()}/predictions/${encodeURIComponent(providerJobId)}/result`, {
      method: "GET",
      timeoutMs: 30_000,
    });
    const task = body.data;
    if (status >= 400 || !task) {
      logger.warn("wavespeed poll not ready", {
        providerJobId,
        status,
        message: errorText(body, "Couldn’t check WaveSpeed status."),
      });
      return { id: providerJobId, status: "generating", progress: 55 };
    }
    const mapped = mapStatus(task.status);
    if (mapped === "complete" && !outputUrl(task.outputs)) {
      logger.warn("wavespeed completed without outputs yet", { providerJobId });
      return { id: providerJobId, status: "generating", progress: 90 };
    }
    return {
      id: task.id ?? providerJobId,
      status: mapped,
      progress: mapProgress(task.status),
      error: mapped === "failed" ? task.error || "Generation failed." : undefined,
    };
  }

  async getResult(providerJobId: string): Promise<ProviderResult | null> {
    const cached = this.results.get(providerJobId);
    if (cached) return cached;
    const { status, body } = await request<{ data?: WaveSpeedTask }>(
      `${baseUrl()}/predictions/${encodeURIComponent(providerJobId)}/result`,
      { method: "GET", timeoutMs: 30_000 },
    );
    const remote = outputUrl(body.data?.outputs);
    if (status >= 400 || !remote) return null;
    const result = await rehostOrKeep(providerJobId, remote);
    this.results.set(providerJobId, result);
    return result;
  }
}

const globalProvider = globalThis as unknown as {
  __gener8WaveSpeed?: WaveSpeedVideoProvider;
};

export const waveSpeedProvider =
  globalProvider.__gener8WaveSpeed ?? new WaveSpeedVideoProvider();
if (!globalProvider.__gener8WaveSpeed) {
  globalProvider.__gener8WaveSpeed = waveSpeedProvider;
}
