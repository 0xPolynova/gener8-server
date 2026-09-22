import { Router } from "express";
import { getSession } from "@/lib/auth/session";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { generateStyleImages } from "@/lib/generation/style-images";
import { asyncHandler } from "@/middleware/async";

export const stylesRouter = Router();

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
