import { env } from "@/lib/config/env";
import { AppError, ERROR_CODES } from "@/lib/errors";
import type { GenerationSettings, GenerationStatus } from "@/types";
import { prepareReferenceImage, prepareReferenceVideo } from "./atlas-media";
import { rehostOrKeep } from "./persist";
import type {
  CreateGenerationInput,
  ProviderJob,
  ProviderResult,
  VideoGenerationProvider,
} from "./provider";

const DEFAULT_BASE = "https://api.atlascloud.ai";

const MODEL_IDS: Record<string, string> = {
  "gener8-fast": env.atlasModelFast,
  "gener8-pro": env.atlasModelPro,
  "gener8-cinematic": env.atlasModelCinematic,
  seedance: env.atlasModelSeedance,
};

type AtlasStatus =
  | "created"
  | "processing"
  | "completed"
  | "succeeded"
  | "failed"
  | "timeout";

interface AtlasEnvelope<T> {
  code?: number | string;
  message?: string;
  error?: string | { message?: string };
  data?: T;
}

interface AtlasPrediction {
  id?: string;
  status?: AtlasStatus | string;
  outputs?: string[];
  error?: string | { message?: string };
}

function baseUrl() {
  return (env.videoProviderBaseUrl || DEFAULT_BASE).replace(/\/$/, "");
}

function apiKey() {
  return (
    env.atlascloudApiKey ||
    env.videoProviderApiKey ||
    process.env.ATLAS_API_KEY ||
    ""
  );
}

function headers() {
  const key = apiKey();
  if (!key) {
    throw new AppError(
      ERROR_CODES.INTERNAL,
      503,
      "Atlas Cloud isn’t configured. Add ATLASCLOUD_API_KEY to .env and restart the API.",
    );
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function atlasUserMessage(raw: string) {
  if (/InputVideoSensitiveContentDetected|copyright restrictions/i.test(raw)) {
    return "Atlas Cloud blocked this base clip (copyright policy). Use original footage you own, or a different video.";
  }
  if (/InputImageSensitiveContentDetected/i.test(raw)) {
    return "Atlas Cloud blocked one of the reference photos (policy). Try different photos.";
  }
  if (/real human faces|likeness|deepfake/i.test(raw)) {
    return "Wan 3.0 blocked this because the photos look like real people. Try stylized or AI-generated portraits.";
  }
  return raw;
}

function errorText(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as AtlasEnvelope<AtlasPrediction> & {
    msg?: string;
  };
  const raw =
    (typeof body.msg === "string" && body.msg) ||
    (typeof body.error === "string" && body.error) ||
    (body.error && typeof body.error === "object" && body.error.message) ||
    (typeof body.message === "string" && body.message) ||
    (typeof body.data?.error === "string" && body.data.error) ||
    (body.data?.error &&
      typeof body.data.error === "object" &&
      body.data.error.message) ||
    "";
  return atlasUserMessage(raw || fallback);
}

function unwrap<T>(body: AtlasEnvelope<T> | T): T {
  if (body && typeof body === "object" && "data" in body && body.data) {
    return body.data;
  }
  return body as T;
}

function mapStatus(status: string | undefined): GenerationStatus {
  switch (status) {
    case "created":
    case "queued":
    case "pending":
      return "queued";
    case "processing":
    case "running":
    case "generating":
      return "generating";
    case "completed":
    case "succeeded":
      return "complete";
    case "failed":
    case "timeout":
    case "cancelled":
    case "canceled":
      return "failed";
    default:
      return status ? "failed" : "generating";
  }
}

function mapProgress(status: string | undefined) {
  switch (status) {
    case "created":
      return 8;
    case "processing":
      return 55;
    case "completed":
    case "succeeded":
      return 100;
    default:
      return 0;
  }
}

function clampDuration(wanted: number) {
  if (wanted < 2) return 2;
  if (wanted > 30) return 30;
  return Math.round(wanted);
}

function pickResolution(
  _modelId: string,
  quality: GenerationSettings["quality"],
) {
  return quality === "high" ? "1080p" : "720p";
}

function pickRatio(aspect: string) {
  if (aspect === "16:9" || aspect === "9:16" || aspect === "1:1") return aspect;
  return "16:9";
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
      "Atlas Cloud didn’t respond. Try again in a moment.",
    );
  } finally {
    clearTimeout(timer);
  }
}

function atlasModel(input: CreateGenerationInput) {
  const hasRefs =
    Boolean(input.referenceVideoUrl) ||
    Boolean(input.referenceImages && input.referenceImages.length);
  if (hasRefs) return env.atlasModelRef;
  return MODEL_IDS[input.settings.model] ?? env.atlasModelFast;
}

export class AtlasCloudVideoProvider implements VideoGenerationProvider {
  readonly name = "atlascloud";
  private results = new Map<string, ProviderResult>();

  async createGeneration(input: CreateGenerationInput): Promise<ProviderJob> {
    const settings = input.settings;
    const modelId = atlasModel(input);
    const images = (input.referenceImages ?? []).filter(Boolean);
    const hasRefs = Boolean(input.referenceVideoUrl) || images.length > 0;
    const payload: Record<string, unknown> = {
      model: modelId,
      prompt: buildPrompt(input.prompt, settings),
      duration: clampDuration(settings.duration ?? 5),
      resolution: pickResolution(settings.model, settings.quality),
      ratio: hasRefs ? "adaptive" : pickRatio(settings.aspectRatio),
      audio: true,
    };
    if (typeof settings.seed === "number" && settings.seed >= 0) {
      payload.seed = settings.seed;
    }
    if (hasRefs) {
      const refers: { url: string; type: "image" | "video" }[] = [];
      if (input.referenceVideoUrl) {
        refers.push({
          url: await prepareReferenceVideo(input.referenceVideoUrl, apiKey()),
          type: "video",
        });
      }
      for (const image of images) {
        refers.push({
          url: await prepareReferenceImage(image, apiKey()),
          type: "image",
        });
      }
      payload.refers = refers;
    }

    const { status, body } = await request<
      AtlasEnvelope<AtlasPrediction> & AtlasPrediction
    >("/api/v1/model/generateVideo", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const data = unwrap(body);
    const id = data.id;
    const atlasCode = Number(
      (body as AtlasEnvelope<AtlasPrediction>).code ?? status,
    );
    if (status >= 400 || (Number.isFinite(atlasCode) && atlasCode !== 200) || !id) {
      const message = errorText(body, "Atlas Cloud rejected the generation request.");
      console.error("[atlascloud] generateVideo failed", status, message);
      throw new AppError(
        ERROR_CODES.GENERATION_FAILED,
        status >= 400 ? status : 502,
        message,
      );
    }

    return {
      id,
      status: mapStatus(data.status ?? "processing"),
      progress: mapProgress(data.status ?? "processing"),
    };
  }

  async getGenerationStatus(providerJobId: string): Promise<ProviderJob> {
    let status: number;
    let body: AtlasEnvelope<AtlasPrediction> & AtlasPrediction;
    try {
      ({ status, body } = await request<
        AtlasEnvelope<AtlasPrediction> & AtlasPrediction
      >(`/api/v1/model/prediction/${encodeURIComponent(providerJobId)}`, {
        method: "GET",
        timeoutMs: 30_000,
      }));
    } catch {
      return {
        id: providerJobId,
        status: "generating",
        progress: 55,
      };
    }
    if (status === 404) {
      return {
        id: providerJobId,
        status: "failed",
        progress: 0,
        error: "UNKNOWN_JOB",
      };
    }
    const message = errorText(body, "Couldn’t check generation status.");
    if (status === 429 || status >= 500) {
      return {
        id: providerJobId,
        status: "generating",
        progress: 55,
      };
    }
    if (status >= 400) {
      return {
        id: providerJobId,
        status: "failed",
        progress: 0,
        error: message,
      };
    }
    const data = unwrap(body);
    const atlasCode = Number(
      (body as AtlasEnvelope<AtlasPrediction>).code ?? 200,
    );
    if (Number.isFinite(atlasCode) && atlasCode !== 200) {
      return {
        id: data.id ?? providerJobId,
        status: "failed",
        progress: 0,
        error: message,
      };
    }
    const mapped = mapStatus(data.status);
    const err =
      mapped === "failed"
        ? errorText(body, "Generation failed. Try regenerating.")
        : undefined;
    return {
      id: data.id ?? providerJobId,
      status: mapped,
      progress: mapProgress(data.status),
      error: err,
    };
  }

  async getResult(providerJobId: string): Promise<ProviderResult | null> {
    const cached = this.results.get(providerJobId);
    if (cached) return cached;

    const { status, body } = await request<
      AtlasEnvelope<AtlasPrediction> & AtlasPrediction
    >(`/api/v1/model/prediction/${encodeURIComponent(providerJobId)}`, {
      method: "GET",
      timeoutMs: 30_000,
    });
    const data = unwrap(body);
    const done =
      data.status === "completed" || data.status === "succeeded";
    if (status >= 400 || !done) return null;
    const remote = data.outputs?.find((url) => /\.mp4(\?|$)/i.test(url)) ?? data.outputs?.[0];
    if (!remote) return null;

    const result = await rehostOrKeep(providerJobId, remote);
    this.results.set(providerJobId, result);
    return result;
  }
}

const globalProvider = globalThis as unknown as {
  __gener8AtlasCloud?: AtlasCloudVideoProvider;
};

export const atlasCloudProvider =
  globalProvider.__gener8AtlasCloud ?? new AtlasCloudVideoProvider();
if (!globalProvider.__gener8AtlasCloud) {
  globalProvider.__gener8AtlasCloud = atlasCloudProvider;
}
