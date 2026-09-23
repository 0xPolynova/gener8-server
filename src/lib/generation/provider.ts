import type {
  GenerationJob,
  GenerationSettings,
  GenerationStatus,
  Video,
} from "@/types";

export interface CreateGenerationInput {
  prompt: string;
  settings: GenerationSettings;
  userId: string;
  referenceVideoUrl?: string | null;
  referenceModel?: string | null;
  referenceImages?: string[];
  firstFrameImage?: string | null;
  lastFrameImage?: string | null;
  omniAssets?: OmniAsset[];
}

export interface OmniAsset {
  type: "image" | "video" | "audio";
  url: string;
  name?: string;
}

export interface ProviderJob {
  id: string;
  status: GenerationStatus;
  progress: number;
  error?: string;
  duration?: number;
}

export interface ProviderResult {
  videoUrl: string;
  thumbnailUrl: string | null;
}

/**
 * Provider abstraction. Swap MockVideoProvider for Kling / Runway / Veo
 * (or any other vendor) by implementing this interface and selecting it
 * from `getVideoProvider()` — UI and API routes stay unchanged.
 */
export interface VideoGenerationProvider {
  readonly name: string;
  createGeneration(input: CreateGenerationInput): Promise<ProviderJob>;
  getGenerationStatus(providerJobId: string): Promise<ProviderJob>;
  getResult(providerJobId: string): Promise<ProviderResult | null>;
  cancel?(providerJobId: string): Promise<void>;
}

export type RecoverableJob = Pick<
  GenerationJob,
  "id" | "provider" | "providerJobId" | "status" | "videoId"
> &
  Partial<Pick<Video, "prompt">>;
