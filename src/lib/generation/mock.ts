import { SAMPLE_VIDEO_URLS } from "@/lib/config/models";
import { hashString, nanoid } from "@/lib/utils";
import type { GenerationStatus } from "@/types";
import type {
  CreateGenerationInput,
  ProviderJob,
  ProviderResult,
  VideoGenerationProvider,
} from "./provider";

interface InternalJob extends ProviderJob {
  createdAt: number;
  durationMs: number;
  result: ProviderResult;
}

const STAGES: { status: GenerationStatus; at: number }[] = [
  { status: "preparing", at: 0 },
  { status: "generating", at: 0.12 },
  { status: "processing", at: 0.72 },
  { status: "complete", at: 1 },
];

/**
 * Local mock provider so the full product can be developed without a paid
 * video API. Replace by implementing VideoGenerationProvider against a
 * real vendor in `live.ts`.
 */
export class MockVideoProvider implements VideoGenerationProvider {
  readonly name = "mock";
  private jobs = new Map<string, InternalJob>();

  async createGeneration(input: CreateGenerationInput): Promise<ProviderJob> {
    const id = `mock_${nanoid(10)}`;
    const durationMs = 9_000 + (hashString(input.prompt) % 4_000);
    const videoUrl =
      SAMPLE_VIDEO_URLS[hashString(input.prompt) % SAMPLE_VIDEO_URLS.length];

    const job: InternalJob = {
      id,
      status: "preparing",
      progress: 4,
      createdAt: Date.now(),
      durationMs,
      result: { videoUrl, thumbnailUrl: null },
    };
    this.jobs.set(id, job);
    return { id, status: job.status, progress: job.progress };
  }

  async getGenerationStatus(providerJobId: string): Promise<ProviderJob> {
    const job = this.jobs.get(providerJobId);
    if (!job) {
      return {
        id: providerJobId,
        status: "failed",
        progress: 0,
        error: "UNKNOWN_JOB",
      };
    }
    const t = Math.min(1, (Date.now() - job.createdAt) / job.durationMs);
    const stage =
      [...STAGES].reverse().find((s) => t >= s.at) ?? STAGES[0];
    job.status = stage.status;
    job.progress = Math.round(t * 100);
    if (job.status === "complete") job.progress = 100;
    return { id: job.id, status: job.status, progress: job.progress };
  }

  async getResult(providerJobId: string): Promise<ProviderResult | null> {
    const job = this.jobs.get(providerJobId);
    if (!job) return null;
    const status = await this.getGenerationStatus(providerJobId);
    if (status.status !== "complete") return null;
    return job.result;
  }
}

const globalJobs = globalThis as unknown as {
  __gener8MockProvider?: MockVideoProvider;
};

export const mockProvider =
  globalJobs.__gener8MockProvider ?? new MockVideoProvider();
if (!globalJobs.__gener8MockProvider) {
  globalJobs.__gener8MockProvider = mockProvider;
}
