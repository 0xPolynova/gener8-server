import { env } from "@/lib/config/env";
import { db } from "@/lib/data/repository";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { resolveVideoModelId } from "@/lib/config/models";
import { prepareReferenceImageBuffer } from "./atlas-media";
import { uploadToFal } from "./fal";
import { persistGeneratedClip } from "./persist";
import type { GenerationSettings, GenerationStatus } from "@/types";
import type {
  CreateGenerationInput,
  ProviderJob,
  ProviderResult,
  VideoGenerationProvider,
} from "./provider";

const DEFAULT_BASE = "https://openrouter.ai/api/v1";

const LEGACY_OPENROUTER: Record<string, string> = {
  "gener8-fast": env.openrouterModelFast,
  "gener8-pro": env.openrouterModelPro,
  "gener8-cinematic": env.openrouterModelCinematic,
  seedance: env.openrouterModelSeedance,
};

function openRouterModelId(settings: GenerationSettings) {
  const requested = settings.model;
  if (requested && LEGACY_OPENROUTER[requested]) return LEGACY_OPENROUTER[requested];
  return resolveVideoModelId(requested).id;
}

function imagePart(url: string, frameType?: "first_frame" | "last_frame") {
  const part: Record<string, unknown> = {
    type: "image_url",
    image_url: { url },
  };
  if (frameType) part.frame_type = frameType;
  return part;
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

async function hostOpenRouterImage(source: string, name: string) {
  if (isPublicHttps(source)) return source;
  const buffer = await prepareReferenceImageBuffer(source);
  const filename = `${name.replace(/[^a-zA-Z0-9._-]/g, "_")}.jpg`;
  const uploaded = await db.uploadGeneratedVideo(`refs/${filename}`, buffer);
  if (uploaded && isPublicHttps(uploaded)) return uploaded;
  try {
    const falUrl = await uploadToFal(buffer, filename, "image/jpeg");
    if (isPublicHttps(falUrl)) return falUrl;
  } catch (error) {
    console.warn("[openrouter] fal image host failed", error);
  }
  throw new AppError(
    ERROR_CODES.GENERATION_FAILED,
    502,
    "Couldn’t publish the reference photo. Try a smaller image.",
  );
}

type OpenRouterStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

interface OpenRouterJob {
  id: string;
  status: OpenRouterStatus;
  polling_url?: string;
  error?: string | { message?: string };
  unsigned_urls?: string[];
}

interface VideoModelInfo {
  id: string;
  supported_durations?: number[];
  supported_resolutions?: string[];
  supported_aspect_ratios?: string[];
}

let modelsCache: { at: number; list: VideoModelInfo[] } | null = null;

function baseUrl() {
  return (env.openrouterBaseUrl || DEFAULT_BASE).replace(/\/$/, "");
}

function apiKey() {
  return env.openrouterApiKey || env.videoProviderApiKey;
}

function headers() {
  const key = apiKey();
  if (!key) {
    throw new AppError(
      ERROR_CODES.INTERNAL,
      503,
      "OpenRouter isn’t configured. Add OPENROUTER_API_KEY to .env and restart the API.",
    );
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": env.appUrl,
    "X-Title": "Gener8",
  };
}

function errorText(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as {
    error?: string | { message?: string };
    message?: string;
  };
  if (typeof body.error === "string") return body.error;
  if (body.error && typeof body.error === "object" && body.error.message) {
    return body.error.message;
  }
  if (typeof body.message === "string") return body.message;
  return fallback;
}

function jobError(job: OpenRouterJob) {
  if (!job.error) return "Generation failed. Try regenerating.";
  if (typeof job.error === "string") return job.error;
  return job.error.message || "Generation failed. Try regenerating.";
}

function mapStatus(status: OpenRouterStatus): GenerationStatus {
  switch (status) {
    case "pending":
      return "queued";
    case "in_progress":
      return "generating";
    case "completed":
      return "complete";
    default:
      return "failed";
  }
}

function mapProgress(status: OpenRouterStatus) {
  switch (status) {
    case "pending":
      return 8;
    case "in_progress":
      return 55;
    case "completed":
      return 100;
    default:
      return 0;
  }
}

function nearestNumber(wanted: number, supported?: number[]) {
  if (!supported?.length || supported.includes(wanted)) return wanted;
  return supported.reduce((best, value) =>
    Math.abs(value - wanted) < Math.abs(best - wanted) ? value : best,
  );
}

function pickResolution(quality: GenerationSettings["quality"], supported?: string[]) {
  const preferred =
    quality === "high"
      ? ["1080p", "2K", "720p", "768p", "4K", "1K", "480p"]
      : ["720p", "768p", "480p", "1080p", "1K", "2K"];
  if (!supported?.length) return preferred[0];
  return preferred.find((value) => supported.includes(value)) ?? supported[0];
}

function buildPrompt(prompt: string, settings: GenerationSettings) {
  const extra: string[] = [];
  if (settings.cameraMovement && settings.cameraMovement !== "static") {
    extra.push(`${settings.cameraMovement} camera movement`);
  }
  if (settings.creativity >= 75) extra.push("highly creative, unexpected details");
  if (settings.promptAdherence >= 80) extra.push("follow the prompt closely");
  if (settings.negativePrompt.trim()) {
    extra.push(`Avoid: ${settings.negativePrompt.trim()}`);
  }
  return extra.length ? `${prompt.trim()}\n\n${extra.join(". ")}.` : prompt.trim();
}

async function request<T>(
  pathName: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ status: number; body: T }> {
  const { timeoutMs = 60_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}${pathName}`, {
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
    return { status: res.status, body };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      ERROR_CODES.PROVIDER_TIMEOUT,
      504,
      "OpenRouter didn’t respond. Try again in a moment.",
    );
  } finally {
    clearTimeout(timer);
  }
}

async function listModels() {
  if (modelsCache && Date.now() - modelsCache.at < 10 * 60_000) {
    return modelsCache.list;
  }
  try {
    const { status, body } = await request<{ data?: VideoModelInfo[] }>(
      "/videos/models",
      { method: "GET", timeoutMs: 15_000 },
    );
    if (status >= 200 && status < 300 && Array.isArray(body.data)) {
      modelsCache = { at: Date.now(), list: body.data };
      return body.data;
    }
  } catch {
    /* use requested params */
  }
  return modelsCache?.list ?? [];
}

export class OpenRouterVideoProvider implements VideoGenerationProvider {
  readonly name = "openrouter";
  private results = new Map<string, ProviderResult>();

  async createGeneration(input: CreateGenerationInput): Promise<ProviderJob> {
    const settings = input.settings;
    const modelId = openRouterModelId(settings);
    const models = await listModels();
    const meta = models.find((model) => model.id === modelId);

    const duration = nearestNumber(settings.duration, meta?.supported_durations);
    const aspectRatio =
      meta?.supported_aspect_ratios?.includes(settings.aspectRatio)
        ? settings.aspectRatio
        : (meta?.supported_aspect_ratios?.[0] ?? settings.aspectRatio);
    const resolution = pickResolution(settings.quality, meta?.supported_resolutions);

    const payload: Record<string, unknown> = {
      model: modelId,
      prompt: buildPrompt(input.prompt, settings),
      duration,
      aspect_ratio: aspectRatio,
      resolution,
      generate_audio: settings.quality === "high",
    };
    if (typeof settings.seed === "number") payload.seed = settings.seed;

    const stamp = `${input.userId}-${Date.now()}`;
    const first = input.firstFrameImage;
    const last = input.lastFrameImage;
    const extras = (input.referenceImages ?? []).filter(Boolean);
    const frames: Record<string, unknown>[] = [];
    if (first) {
      frames.push(
        imagePart(await hostOpenRouterImage(first, `${stamp}-first`), "first_frame"),
      );
    }
    if (last) {
      frames.push(
        imagePart(await hostOpenRouterImage(last, `${stamp}-last`), "last_frame"),
      );
    }
    if (frames.length) payload.frame_images = frames;
    if (extras.length) {
      payload.input_references = await Promise.all(
        extras.slice(0, 4).map(async (image, index) =>
          imagePart(await hostOpenRouterImage(image, `${stamp}-style-${index}`)),
        ),
      );
    }

    const { status, body } = await request<OpenRouterJob & { error?: unknown }>(
      "/videos",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );

    if (status >= 400 || !("id" in body) || !body.id) {
      throw new AppError(
        ERROR_CODES.GENERATION_FAILED,
        status >= 400 ? status : 502,
        errorText(body, "OpenRouter rejected the generation request."),
      );
    }

    return {
      id: body.id,
      status: mapStatus(body.status ?? "pending"),
      progress: mapProgress(body.status ?? "pending"),
    };
  }

  async getGenerationStatus(providerJobId: string): Promise<ProviderJob> {
    const { status, body } = await request<OpenRouterJob>(
      `/videos/${encodeURIComponent(providerJobId)}`,
      { method: "GET", timeoutMs: 30_000 },
    );
    if (status === 404) {
      return {
        id: providerJobId,
        status: "failed",
        progress: 0,
        error: "UNKNOWN_JOB",
      };
    }
    if (status >= 400) {
      throw new AppError(
        ERROR_CODES.GENERATION_FAILED,
        502,
        errorText(body, "Couldn’t check generation status."),
      );
    }
    const mapped = mapStatus(body.status);
    return {
      id: body.id ?? providerJobId,
      status: mapped,
      progress: mapProgress(body.status),
      error: mapped === "failed" ? jobError(body) : undefined,
    };
  }

  async getResult(providerJobId: string): Promise<ProviderResult | null> {
    const cached = this.results.get(providerJobId);
    if (cached) return cached;

    const { status, body } = await request<OpenRouterJob>(
      `/videos/${encodeURIComponent(providerJobId)}`,
      { method: "GET", timeoutMs: 30_000 },
    );
    if (status >= 400 || body.status !== "completed") return null;

    const downloadUrl =
      body.unsigned_urls?.[0] ??
      `${baseUrl()}/videos/${encodeURIComponent(providerJobId)}/content?index=0`;

    const download = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${apiKey()}` },
    });
    if (!download.ok) {
      throw new AppError(
        ERROR_CODES.UPLOAD_FAILED,
        502,
        "OpenRouter finished, but the video file couldn’t be downloaded.",
      );
    }
    const buffer = Buffer.from(await download.arrayBuffer());
    const result = await persistGeneratedClip(providerJobId, buffer);
    this.results.set(providerJobId, result);
    return result;
  }
}

const globalProvider = globalThis as unknown as {
  __gener8OpenRouter?: OpenRouterVideoProvider;
};

export const openRouterProvider =
  globalProvider.__gener8OpenRouter ?? new OpenRouterVideoProvider();
if (!globalProvider.__gener8OpenRouter) {
  globalProvider.__gener8OpenRouter = openRouterProvider;
}
