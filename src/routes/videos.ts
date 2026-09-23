import { Router } from "express";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/data/repository";
import { AppError, ERROR_CODES } from "@/lib/errors";
import type { DiscoverFilter, Video } from "@/types";
import { asyncHandler } from "@/middleware/async";

export const videosRouter = Router();

videosRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    const filter = (String(req.query.filter ?? "trending") ||
      "trending") as DiscoverFilter;
    const videos = await db.listDiscover(filter, session?.userId);
    res.json({ videos });
  }),
);

videosRouter.put(
  "/reorder",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session) throw new AppError(ERROR_CODES.UNAUTHENTICATED, 401);
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((id: unknown): id is string => typeof id === "string")
      : [];
    if (!ids.length) {
      throw new AppError(ERROR_CODES.INVALID_PROMPT, 400, "No video order provided.");
    }
    await db.reorderDiscover(ids);
    res.json({ ok: true });
  }),
);

videosRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    const video = await db.getVideo(req.params.id, session?.userId);
    if (!video) throw new AppError(ERROR_CODES.NOT_FOUND, 404);
    if (video.visibility === "private" && video.userId !== session?.userId) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 404);
    }
    res.json({ video });
  }),
);

videosRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session) throw new AppError(ERROR_CODES.UNAUTHENTICATED, 401);
    const existing = await db.getVideo(req.params.id, session.userId);
    if (!existing || existing.userId !== session.userId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 403);
    }
    const patch: Partial<Video> = {};
    if (req.body?.visibility === "public" || req.body?.visibility === "private") {
      patch.visibility = req.body.visibility;
      patch.publishedAt =
        req.body.visibility === "public" ? new Date().toISOString() : null;
    }
    if (typeof req.body?.publicPrompt === "boolean") {
      patch.publicPrompt = req.body.publicPrompt;
    }
    if (typeof req.body?.title === "string") {
      const title = req.body.title.replace(/\s+/g, " ").trim().slice(0, 80);
      if (title) patch.title = title;
    }
    await db.updateVideo(req.params.id, patch);
    res.json({ video: await db.getVideo(req.params.id, session.userId) });
  }),
);

videosRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session) throw new AppError(ERROR_CODES.UNAUTHENTICATED, 401);
    const existing = await db.getVideo(req.params.id, session.userId);
    if (!existing || existing.userId !== session.userId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 403);
    }
    await db.updateVideo(req.params.id, {
      status: "archived",
      visibility: "private",
    });
    res.json({ ok: true });
  }),
);

videosRouter.post(
  "/:id/like",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session) throw new AppError(ERROR_CODES.UNAUTHENTICATED, 401);
    const video = await db.getVideo(req.params.id);
    if (!video) throw new AppError(ERROR_CODES.NOT_FOUND, 404);
    const result = await db.toggleLike(session.userId, req.params.id);
    res.json(result);
  }),
);

videosRouter.post(
  "/:id/view",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    const video = await db.getVideo(req.params.id);
    if (!video) throw new AppError(ERROR_CODES.NOT_FOUND, 404);
    const views = await db.recordView(req.params.id, session?.userId ?? null);
    res.json({ views });
  }),
);
