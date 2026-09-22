import { Router } from "express";
import multer from "multer";
import { getSession } from "@/lib/auth/session";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { persistPublicFile } from "@/lib/generation/persist";
import { asyncHandler } from "@/middleware/async";

export const refsRouter = Router();

const MAX_VIDEO_BYTES = 80 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES },
});

refsRouter.post(
  "/",
  (req, res, next) => {
    upload.single("file")(req, res, (error) => {
      if (!error) {
        next();
        return;
      }
      next(
        new AppError(
          ERROR_CODES.UPLOAD_FAILED,
          400,
          "Video must be an MP4/MOV under 80 MB.",
        ),
      );
    });
  },
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session) throw new AppError(ERROR_CODES.UNAUTHENTICATED, 401);

    const file = req.file;
    if (!file?.buffer?.length) {
      throw new AppError(
        ERROR_CODES.UPLOAD_FAILED,
        400,
        "Add a video file to use as the base clip.",
      );
    }
    if (!file.mimetype.startsWith("video/")) {
      throw new AppError(
        ERROR_CODES.UPLOAD_FAILED,
        400,
        "Use a video file (MP4 or MOV).",
      );
    }

    const ext = file.mimetype.includes("quicktime") ? "mov" : "mp4";
    const url = await persistPublicFile(
      `refs-vid-${session.userId}-${Date.now()}.${ext}`,
      file.buffer,
    );
    res.json({ url });
  }),
);
