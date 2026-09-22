import { Router } from "express";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/data/repository";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { asyncHandler } from "@/middleware/async";

export const usersRouter = Router();

usersRouter.get(
  "/:username",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    const { user, videos } = await db.listPublicByUsername(
      req.params.username,
      session?.userId,
    );
    if (!user) throw new AppError(ERROR_CODES.NOT_FOUND, 404);
    const stats = await db.userStats(user.id);
    const following = session
      ? await db.isFollowing(session.userId, user.id)
      : false;
    res.json({ user, videos, stats, following });
  }),
);

usersRouter.post(
  "/:username",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session) throw new AppError(ERROR_CODES.UNAUTHENTICATED, 401);
    const result = await db.toggleFollow(session.userId, req.params.username);
    if (!result) throw new AppError(ERROR_CODES.NOT_FOUND, 404);
    res.json(result);
  }),
);
