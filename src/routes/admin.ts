import { spawn } from "node:child_process";
import { Router } from "express";
import ffmpegPath from "ffmpeg-static";
import multer from "multer";
import { getSession } from "@/lib/auth/session";
import { isAdminWallet } from "@/lib/admin";
import { readKolLibrary, writeKolLibrary } from "@/lib/kol-library";
import { db } from "@/lib/data/repository";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { sanitizeTitle } from "@/lib/format";
import { persistGeneratedClip } from "@/lib/generation/persist";
import { nanoid } from "@/lib/utils";
import { asyncHandler } from "@/middleware/async";
import type { AspectRatio, Video } from "@/types";

export const adminRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});

function publicFile(url: string) {
  try {
    const host = new URL(url).hostname;
    return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
  } catch {
    return false;
  }
}

function probe(buffer: Buffer): Promise<{ duration: number; aspectRatio: AspectRatio }> {
  return new Promise((resolve) => {
    if (!ffmpegPath) {
      resolve({ duration: 15, aspectRatio: "9:16" });
      return;
    }
    const child = spawn(ffmpegPath, ["-i", "pipe:0"], { windowsHide: true });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", () => resolve({ duration: 15, aspectRatio: "9:16" }));
    child.on("close", () => {
      const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      const sizeMatch = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
      const seconds = durationMatch
        ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
        : 15;
      const width = sizeMatch ? Number(sizeMatch[1]) : 9;
      const height = sizeMatch ? Number(sizeMatch[2]) : 16;
      const aspectRatio: AspectRatio =
        width > height * 1.15 ? "16:9" : height > width * 1.15 ? "9:16" : "1:1";
      const duration = Math.min(30, Math.max(2, Math.round(seconds)));
      resolve({ duration, aspectRatio });
    });
    child.stdin.write(buffer);
    child.stdin.end();
  });
}

adminRouter.get(
  "/kols",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session || !isAdminWallet(session.walletAddress)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 403, "This page is not available.");
    }
    const rows = await readKolLibrary();
    res.json({ kols: rows.filter((kol) => kol.status === "pending") });
  }),
);

adminRouter.post(
  "/kols/:id",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session || !isAdminWallet(session.walletAddress)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 403, "This page is not available.");
    }
    const action: "approved" | "denied" | null =
      req.body?.action === "approve" ? "approved" : req.body?.action === "deny" ? "denied" : null;
    if (!action) throw new AppError(ERROR_CODES.INVALID_PROMPT, 400, "Choose approve or deny.");
    const rows = await readKolLibrary();
    const next = rows.map((kol) => (kol.id === req.params.id ? { ...kol, status: action } : kol));
    if (!next.some((kol) => kol.id === req.params.id)) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 404);
    }
    await writeKolLibrary(next);
    res.json({ ok: true });
  }),
);

adminRouter.post(
  "/discover",
  (req, res, next) => {
    upload.single("file")(req, res, (error) => {
      if (!error) {
        next();
        return;
      }
      next(new AppError(ERROR_CODES.UPLOAD_FAILED, 400, "Video must be under 80 MB."));
    });
  },
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session || !isAdminWallet(session.walletAddress)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 403, "This page is not available.");
    }
    const file = req.file;
    if (!file?.buffer?.length || !file.mimetype.startsWith("video/")) {
      throw new AppError(ERROR_CODES.UPLOAD_FAILED, 400, "Add a video file.");
    }
    const prompt = String(req.body?.prompt ?? "").trim();
    const title = sanitizeTitle(req.body?.title, "");
    if (!title) {
      throw new AppError(ERROR_CODES.INVALID_PROMPT, 400, "Name the video first.");
    }
    if (prompt.length < 8) {
      throw new AppError(ERROR_CODES.INVALID_PROMPT, 400, "Write the remix prompt.");
    }

    const clip = await persistGeneratedClip(`discover-${nanoid(8)}`, file.buffer);
    if (!publicFile(clip.videoUrl)) {
      throw new AppError(
        ERROR_CODES.UPLOAD_FAILED,
        502,
        "The video did not reach storage, so it cannot be published.",
      );
    }
    const measured = await probe(file.buffer);
    const now = new Date().toISOString();
    const video: Video = {
      id: `vid_${nanoid(10)}`,
      userId: session.userId,
      prompt,
      publicPrompt: true,
      title,
      videoUrl: clip.videoUrl,
      thumbnailUrl: clip.thumbnailUrl,
      poster: { from: "#050505", via: "#16120a", to: "#2a2208", accent: "#FBE418" },
      model: "wan3.0",
      aspectRatio: measured.aspectRatio,
      duration: measured.duration as Video["duration"],
      quality: "standard",
      status: "complete",
      visibility: "public",
      createdAt: now,
      publishedAt: now,
      provider: "upload",
      providerJobId: null,
      views: 0,
      likes: 0,
      category: "experimental",
      gridSpan: measured.aspectRatio === "9:16" ? "tall" : "normal",
    };
    await db.createVideo(video);
    res.json({ video: await db.getVideo(video.id, session.userId) });
  }),
);
