import { Router } from "express";
import { getSession } from "@/lib/auth/session";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { generateStyleImages } from "@/lib/generation/style-images";
import {
  cloudflareImagesConfigured,
  listKolStyles,
  readImageBytes,
  saveKolStyle,
  uploadCloudflareImage,
} from "@/lib/generation/cloudflare-images";
import { asyncHandler } from "@/middleware/async";

export const stylesRouter = Router();

stylesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session) throw new AppError(ERROR_CODES.UNAUTHENTICATED, 401);
    const handle = String(req.query.handle ?? "").trim();
    if (!handle) throw new AppError(ERROR_CODES.INVALID_PROMPT, 400, "Missing KOL.");
    const cursor = String(req.query.cursor ?? "").trim() || null;
    const page = await listKolStyles(handle, cursor, 15);
    res.json(page);
  }),
);

stylesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session) throw new AppError(ERROR_CODES.UNAUTHENTICATED, 401);

    const imageUrl = String(req.body?.imageUrl ?? "").trim();
    const style = String(req.body?.style ?? "").trim();
    if (!imageUrl.startsWith("https://")) {
      throw new AppError(ERROR_CODES.INVALID_PROMPT, 400, "A reference image URL is required.");
    }
    if (style.length < 2 || style.length > 240) {
      throw new AppError(ERROR_CODES.INVALID_PROMPT, 400, "Describe the clothing style in a short phrase.");
    }

    const urls = await generateStyleImages({
      imageUrl,
      style,
      userId: session.userId,
    });
    res.json({ images: urls.map((url) => ({ url })) });
  }),
);

stylesRouter.post(
  "/select",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session) throw new AppError(ERROR_CODES.UNAUTHENTICATED, 401);

    const kolId = String(req.body?.kolId ?? "").trim();
    const handle = String(req.body?.handle ?? "").trim();
    const style = String(req.body?.style ?? "").trim();
    const imageUrl = String(req.body?.imageUrl ?? "").trim();
    if (!kolId || !handle || !imageUrl.startsWith("http")) {
      throw new AppError(ERROR_CODES.INVALID_PROMPT, 400, "Missing style selection.");
    }

    if (!cloudflareImagesConfigured()) {
      throw new AppError(
        ERROR_CODES.GENERATION_FAILED,
        500,
        "Cloudflare Images isn’t configured, so this style can’t be saved.",
      );
    }
    const bytes = await readImageBytes(imageUrl);
    const uploaded = await uploadCloudflareImage(bytes, `${handle}-style.jpg`, {
      kind: "kol-style",
      handle,
      kolId,
      style,
    });
    if (!uploaded) {
      throw new AppError(ERROR_CODES.UPLOAD_FAILED, 502, "Couldn’t save this style to the CDN.");
    }
    const url = uploaded.url;
    const cfImageId = uploaded.id;
    const cdn = true;

    const stored = await saveKolStyle({
      kolId,
      handle,
      style,
      imageUrl: url,
      cfImageId,
      userId: session.userId,
    });
    res.json({ url, cdn, stored });
  }),
);
