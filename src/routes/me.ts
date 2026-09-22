import { Router } from "express";
import multer from "multer";
import {
  buildSession,
  getSession,
  setSessionCookie,
  signSession,
} from "@/lib/auth/session";
import { db } from "@/lib/data/repository";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { syncUserJobs } from "@/lib/generation/sync";
import { assertUsername, assertXHandle } from "@/lib/profile";
import type { CreationsTab } from "@/types";
import { asyncHandler } from "@/middleware/async";

export const meRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
});

meRouter.get(
  "/videos",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session) throw new AppError(ERROR_CODES.UNAUTHENTICATED, 401);
    const tab = (String(req.query.tab ?? "all") || "all") as CreationsTab;
    await syncUserJobs(session.userId);
    const videos = await db.listUserVideos(session.userId, tab);
    const hydrated = await Promise.all(
      videos.map((v) => db.getVideo(v.id, session.userId)),
    );
    res.json({ videos: hydrated });
  }),
);

meRouter.post(
  "/profile",
  upload.single("avatar"),
  asyncHandler(async (req, res) => {
    const existing = await getSession(req);
    const wallet = String(req.body?.wallet ?? existing?.walletAddress ?? "").trim();
    if (!existing && !wallet) {
      throw new AppError(ERROR_CODES.UNAUTHENTICATED, 401);
    }

    const usernameResult = assertUsername(String(req.body?.username ?? ""));
    if (!usernameResult.ok) {
      throw new AppError(ERROR_CODES.USERNAME_INVALID, 400);
    }
    const xResult = assertXHandle(String(req.body?.xHandle ?? ""));
    if (!xResult.ok) {
      throw new AppError(
        ERROR_CODES.USERNAME_INVALID,
        400,
        "That X handle doesn’t look right.",
      );
    }

    const account =
      existing ??
      (await (async () => {
        const created = await db.upsertUserFromWallet(wallet);
        return buildSession({
          userId: created.id,
          username: created.username,
          displayName: created.displayName,
          walletAddress: wallet,
        });
      })());

    let avatarUrl: string | null | undefined;
    const file = req.file;
    if (file) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
        throw new AppError(ERROR_CODES.UPLOAD_FAILED, 400, "Use a JPG, PNG, or WebP image.");
      }
      avatarUrl = await db.uploadAvatar(account.userId, {
        buffer: file.buffer,
        mimetype: file.mimetype,
      });
    }

    try {
      const user = await db.completeProfile(account.userId, {
        username: usernameResult.username,
        displayName: usernameResult.username,
        xHandle: xResult.handle,
        avatarUrl,
      });
      if (!user) throw new AppError(ERROR_CODES.NOT_FOUND, 404);
      const nextSession = buildSession({
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        walletAddress: account.walletAddress,
      });
      const token = await signSession(nextSession);
      setSessionCookie(res, token);
      res.json({ user, session: nextSession, token });
    } catch (error) {
      if (error instanceof Error && error.name === "USERNAME_TAKEN") {
        throw new AppError(ERROR_CODES.USERNAME_TAKEN, 409);
      }
      throw error;
    }
  }),
);
