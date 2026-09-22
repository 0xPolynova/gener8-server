import { Router } from "express";
import multer from "multer";
import { getSession } from "@/lib/auth/session";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { persistPublicFile } from "@/lib/generation/persist";
import { asyncHandler } from "@/middleware/async";

export const refsRouter = Router();

const MAX_FILE_BYTES = 80 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
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
          "File must be an image or video under 80 MB.",
        ),
      );
    });
  },
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session) throw new AppError(ERROR_CODES.UNAUTHENTICATED, 401);

    const file = req.file;
    if (!file?.buffer?.length) {
      throw new AppError(ERROR_CODES.UPLOAD_FAILED, 400, "Add a file to upload.");
    }

    const isVideo = file.mimetype.startsWith("video/");
    const isImage = file.mimetype.startsWith("image/");

    if (!isVideo && !isImage) {
      throw new AppError(
        ERROR_CODES.UPLOAD_FAILED,
        400,
        "Only image or video files are supported.",
      );
    }

    let ext: string;
    if (isVideo) {
      ext = file.mimetype.includes("quicktime") ? "mov" : "mp4";
    } else {
      ext = file.mimetype.includes("png")
        ? "png"
        : file.mimetype.includes("gif")
          ? "gif"
          : file.mimetype.includes("webp")
            ? "webp"
            : "jpg";
    }

    const prefix = isVideo ? "refs-vid" : "refs-img";
    const url = await persistPublicFile(
      `${prefix}-${session.userId}-${Date.now()}.${ext}`,
      file.buffer,
    );
    const type = isVideo ? "video" : "image";
    res.json({ url, type });
  }),
);
