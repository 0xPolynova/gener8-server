import { db } from "@/lib/data/repository";
import { getVideoProvider } from "@/lib/generation";
import { logger } from "@/lib/log";
import type { GenerationJob } from "@/types";

const IN_FLIGHT = new Set([
  "queued",
  "preparing",
  "generating",
  "processing",
]);

export async function syncGenerationJob(job: GenerationJob) {
  if (!job.providerJobId) return await db.getJob(job.id);
  if (!IN_FLIGHT.has(job.status)) return job;

  const provider = getVideoProvider(job.provider);
  const status = await provider.getGenerationStatus(job.providerJobId);

  if (status.status === "failed") {
    logger.error("generation job failed", {
      jobId: job.id,
      videoId: job.videoId,
      provider: job.provider,
      providerJobId: job.providerJobId,
      error: status.error || "Generation failed.",
    });
    const updated = await db.updateJob(job.id, {
      status: "failed",
      progress: status.progress,
      errorCode: "GENERATION_FAILED",
      errorMessage: status.error || "Generation failed. Try regenerating.",
      completedAt: new Date().toISOString(),
    });
    await db.updateVideo(job.videoId, {
      status: "failed",
      errorMessage: status.error || "Generation failed. Try regenerating.",
    });
    return updated;
  }

  if (status.status === "complete") {
    const result = await provider.getResult(job.providerJobId);
    if (!result?.videoUrl) {
      logger.warn("generation complete but video not ready yet", {
        jobId: job.id,
        videoId: job.videoId,
        provider: job.provider,
        providerJobId: job.providerJobId,
      });
      const updated = await db.updateJob(job.id, {
        status: "generating",
        progress: Math.max(job.progress, 90),
      });
      await db.updateVideo(job.videoId, { status: "generating" });
      return updated;
    }
    const updated = await db.updateJob(job.id, {
      status: "complete",
      progress: 100,
      completedAt: new Date().toISOString(),
    });
    await db.updateVideo(job.videoId, {
      status: "complete",
      videoUrl: result.videoUrl,
      thumbnailUrl: result.thumbnailUrl,
    });
    return updated;
  }

  const updated = await db.updateJob(job.id, {
    status: status.status,
    progress: status.progress,
  });
  await db.updateVideo(job.videoId, { status: status.status });
  return updated;
}

export async function syncUserJobs(userId: string) {
  const jobs = (await db.listJobsForUser(userId)).filter((job) =>
    IN_FLIGHT.has(job.status),
  );
  for (const job of jobs) {
    try {
      await syncGenerationJob(job);
    } catch (error) {
      logger.error("syncUserJobs failed", {
        jobId: job.id,
        provider: job.provider,
        providerJobId: job.providerJobId,
        err: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
