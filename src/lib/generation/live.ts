/**
 * ──────────────────────────────────────────────────────────────────────────
 * LIVE VIDEO PROVIDER STUB
 * ──────────────────────────────────────────────────────────────────────────
 * Implement VideoGenerationProvider against Kling, Runway, Veo, or another
 * vendor. Keep API keys in server env only:
 *
 *   VIDEO_PROVIDER_API_KEY
 *   VIDEO_PROVIDER_BASE_URL
 *   VIDEO_PROVIDER_WEBHOOK_SECRET
 *
 * Then register the class in `src/lib/generation/index.ts`.
 */

import type {
  CreateGenerationInput,
  ProviderJob,
  ProviderResult,
  VideoGenerationProvider,
} from "./provider";
import { AppError, ERROR_CODES } from "@/lib/errors";

export class LiveVideoProvider implements VideoGenerationProvider {
  readonly name = "live";

  async createGeneration(_input: CreateGenerationInput): Promise<ProviderJob> {
    throw new AppError(
      ERROR_CODES.INTERNAL,
      501,
      "Live video provider is not configured.",
    );
  }

  async getGenerationStatus(_providerJobId: string): Promise<ProviderJob> {
    throw new AppError(
      ERROR_CODES.INTERNAL,
      501,
      "Live video provider is not configured.",
    );
  }

  async getResult(_providerJobId: string): Promise<ProviderResult | null> {
    return null;
  }
}
