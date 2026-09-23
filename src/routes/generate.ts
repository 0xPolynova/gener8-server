import { Router } from "express";
import { getSession } from "@/lib/auth/session";
import { env } from "@/lib/config/env";
import { db } from "@/lib/data/repository";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { evaluateEligibility } from "@/lib/gating/evaluate";
import { providerForGeneration } from "@/lib/generation";
import { syncGenerationJob } from "@/lib/generation/sync";
import {
  MAX_PROMPT_LENGTH,
  MIN_PROMPT_LENGTH,
  resolveVideoModelId,
} from "@/lib/config/models";
import { sanitizeTitle } from "@/lib/format";
import { nanoid } from "@/lib/utils";
import type { GenerationJob, GenerationSettings, PosterPalette, Video, Visibility } from "@/types";
import { asyncHandler } from "@/middleware/async";
import { logger, serializeError } from "@/lib/log";

export const generateRouter = Router();
const recent = new Map<string, number>();

function paletteFromPrompt(prompt: string): PosterPalette {
  const accents = ["#FBE418", "#FCEC4A", "#e8c547", "#ff9a3c", "#ff6a2a"];
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) hash = (hash << 5) - hash + prompt.charCodeAt(i);
  const n = Math.abs(hash);
  return {
    from: "#050505",
    via: "#16120a",
    to: "#2a2208",
    accent: accents[n % accents.length],
  };
}

generateRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session) throw new AppError(ERROR_CODES.UNAUTHENTICATED, 401);
    await db.rememberSessionUser(session);

    const prompt = String(req.body?.prompt ?? "").trim();
    const settings = req.body?.settings as GenerationSettings;
    const visibility: Visibility =
      req.body?.visibility === "public" ? "public" : "private";
    const title = sanitizeTitle(req.body?.title, "");
    if (!title) {
      throw new AppError(ERROR_CODES.INVALID_PROMPT, 400, "Name the video first.");
    }

    if (prompt.length < MIN_PROMPT_LENGTH) {
      throw new AppError(ERROR_CODES.INVALID_PROMPT, 400);
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      throw new AppError(ERROR_CODES.INVALID_PROMPT, 400, "Prompt is too long.");
    }

    const eligibility = await evaluateEligibility({
      session,
      walletConnected: true,
      walletAddress: session.walletAddress,
    });

    if (eligibility.state === "insufficient") {
      throw new AppError(ERROR_CODES.INSUFFICIENT_BALANCE, 403);
    }
    if (eligibility.state === "limit_reached") {
      const cap = eligibility.dailyLimit ?? 1;
      throw new AppError(
        ERROR_CODES.GENERATION_LIMIT,
        429,
        `You can generate ${cap} video${cap === 1 ? "" : "s"} an hour at your GENER8 balance.`,
      );
    }
    if (eligibility.state !== "eligible" || !eligibility.tier) {
      throw new AppError(ERROR_CODES.UNAUTHENTICATED, 401);
    }

    const last = recent.get(session.userId) ?? 0;
    if (Date.now() - last < 2500) {
      throw new AppError(ERROR_CODES.RATE_LIMITED, 429);
    }
    recent.set(session.userId, Date.now());

    const jobs = await db.listJobsForUser(session.userId);
    const inFlight = jobs.some((job) =>
      ["queued", "preparing", "generating", "processing"].includes(job.status),
    );
    if (inFlight) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        429,
        "Wait until your current video finishes before starting another.",
      );
    }
    const cap = eligibility.tier.hourlyGenerations;
    if (cap != null) {
      const hourAgo = Date.now() - 60 * 60 * 1000;
      const startedThisHour = jobs.filter((job) => +new Date(job.createdAt) >= hourAgo).length;
      if (startedThisHour >= cap) {
        throw new AppError(
          ERROR_CODES.GENERATION_LIMIT,
          429,
          `You can generate ${cap} video${cap === 1 ? "" : "s"} an hour at your GENER8 balance.`,
        );
      }
    }

    const model = resolveVideoModelId(settings?.model);
    if (!eligibility.tier.models.includes(model.id) && eligibility.tier.id < model.minTier) {
      throw new AppError(
        ERROR_CODES.INSUFFICIENT_BALANCE,
        403,
        "Your GENER8 tier doesn’t include this model yet.",
      );
    }

    const createInput = {
      prompt,
      settings,
      userId: session.userId,
      referenceVideoUrl:
        typeof req.body?.referenceVideoUrl === "string"
          ? req.body.referenceVideoUrl
          : null,
      referenceModel:
        req.body?.referenceModel === env.wavespeedModelSeedance
          ? env.wavespeedModelSeedance
          : null,
      referenceImages: Array.isArray(req.body?.referenceImages)
        ? req.body.referenceImages.filter(
            (item: unknown): item is string =>
              typeof item === "string" && item.length > 0,
          )
        : [],
      firstFrameImage:
        typeof req.body?.firstFrameImage === "string"
          ? req.body.firstFrameImage
          : null,
      lastFrameImage:
        typeof req.body?.lastFrameImage === "string"
          ? req.body.lastFrameImage
          : null,
      omniAssets: Array.isArray(req.body?.omniAssets)
        ? req.body.omniAssets.filter(
            (a: unknown): a is { type: "image" | "video" | "audio"; url: string } =>
              typeof a === "object" &&
              a !== null &&
              typeof (a as Record<string, unknown>).url === "string" &&
              ["image", "video", "audio"].includes((a as Record<string, unknown>).type as string),
          )
        : [],
    };
    if (createInput.referenceVideoUrl) {
      createInput.firstFrameImage = null;
      createInput.lastFrameImage = null;
    }
    const provider = providerForGeneration(createInput);
    const now = new Date().toISOString();
    const videoId = `vid_${nanoid(10)}`;
    const jobId = `job_${nanoid(10)}`;

    const video: Video = {
      id: videoId,
      userId: session.userId,
      prompt,
      publicPrompt: Boolean(settings?.publicPrompt ?? true),
      title,
      videoUrl: "",
      thumbnailUrl: null,
      poster: paletteFromPrompt(prompt),
      model: createInput.referenceModel || model.id,
      aspectRatio: settings?.aspectRatio ?? "16:9",
      duration: settings?.duration ?? 5,
      quality: settings?.quality ?? "standard",
      status: "preparing",
      visibility,
      createdAt: now,
      publishedAt: visibility === "public" ? now : null,
      provider: provider.name,
      providerJobId: null,
      views: 0,
      likes: 0,
      category: "experimental",
      seed: settings?.seed ?? null,
      negativePrompt: settings?.negativePrompt ?? "",
      cameraMovement: settings?.cameraMovement ?? "static",
      promptAdherence: settings?.promptAdherence ?? 70,
      creativity: settings?.creativity ?? 50,
    };

    await db.createVideo(video);

    let providerJob;
    try {
      providerJob = await provider.createGeneration(createInput);
    } catch (error) {
      logger.error("provider createGeneration failed", {
        provider: provider.name,
        model: model.id,
        videoId,
        userId: session.userId,
        hasReferenceVideo: Boolean(createInput.referenceVideoUrl),
        referenceImages: createInput.referenceImages.length,
        err: serializeError(error),
      });
      await db.updateVideo(videoId, {
        status: "failed",
        errorMessage:
          error instanceof Error
            ? error.message
            : "Generation failed. Try regenerating.",
      });
      throw error;
    }

    const job: GenerationJob = {
      id: jobId,
      userId: session.userId,
      videoId,
      status: providerJob.status,
      progress: providerJob.progress,
      prompt,
      settings,
      provider: provider.name,
      providerJobId: providerJob.id,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: null,
    };

    await db.createJob(job);
    await db.updateVideo(videoId, {
      providerJobId: providerJob.id,
      status: providerJob.status,
      ...(providerJob.duration ? { duration: providerJob.duration } : {}),
    });
    await db.incrementDaily(session.userId);

    res.json({ job, video: await db.getVideo(videoId, session.userId) });
  }),
);

generateRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session) throw new AppError(ERROR_CODES.UNAUTHENTICATED, 401);
    const job = await db.getJob(req.params.id);
    if (!job || job.userId !== session.userId) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 404);
    }
    let updated = job;
    try {
      updated = (await syncGenerationJob(job)) ?? job;
    } catch (error) {
      logger.error("provider poll failed", {
        jobId: job.id,
        videoId: job.videoId,
        provider: job.provider,
        providerJobId: job.providerJobId,
        err: serializeError(error),
      });
      updated = job;
    }
    res.json({
      job: updated,
      video: await db.getVideo(job.videoId, session.userId),
    });
  }),
);
