import { Router } from "express";
import multer from "multer";
import { getSession } from "@/lib/auth/session";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { uploadCloudflareImage } from "@/lib/generation/cloudflare-images";
import { readKolLibrary, writeKolLibrary } from "@/lib/kol-library";
import { nanoid } from "@/lib/utils";
import { asyncHandler } from "@/middleware/async";

export const kolsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

function handleFromName(name: string) {
  const handle = name.replace(/[^A-Za-z0-9]/g, "");
  return handle.slice(0, 24);
}

kolsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const rows = await readKolLibrary();
    res.json({
      kols: rows
        .filter((kol) => kol.status === "approved")
        .map(({ id, name, handle, avatar }) => ({ id, name, handle, avatar })),
    });
  }),
);

kolsRouter.post(
  "/",
  (req, res, next) => {
    upload.single("file")(req, res, (error) => {
      if (!error) {
        next();
        return;
      }
      next(new AppError(ERROR_CODES.UPLOAD_FAILED, 400, "Image must be under 12 MB."));
    });
  },
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session) throw new AppError(ERROR_CODES.UNAUTHENTICATED, 401);
    const file = req.file;
    if (!file?.buffer?.length || !file.mimetype.startsWith("image/")) {
      throw new AppError(ERROR_CODES.UPLOAD_FAILED, 400, "Add a photo of the KOL.");
    }
    const name = String(req.body?.name ?? "").trim();
    const handle = handleFromName(name);
    if (name.length < 2 || handle.length < 2) {
      throw new AppError(ERROR_CODES.INVALID_PROMPT, 400, "Add the KOL’s name.");
    }
    const library = await readKolLibrary();
    if (library.some((kol) => kol.handle.toLowerCase() === handle.toLowerCase() && kol.status !== "denied")) {
      throw new AppError(ERROR_CODES.USERNAME_TAKEN, 409, "That KOL is already in review or in the library.");
    }
    const image = await uploadCloudflareImage(file.buffer, `${handle}-kol.jpg`, {
      kind: "kol-submission",
      handle,
    });
    if (!image) {
      throw new AppError(ERROR_CODES.UPLOAD_FAILED, 502, "Couldn’t store the photo.");
    }
    const row = {
      id: `kol_${nanoid(8)}`,
      name,
      handle,
      avatar: image.url,
      status: "pending" as const,
      submittedBy: session.userId,
      createdAt: new Date().toISOString(),
    };
    await writeKolLibrary([row, ...library]);
    res.json({ ok: true });
  }),
);
