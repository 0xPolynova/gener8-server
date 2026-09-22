import { env } from "@/lib/config/env";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { persistPublicFile } from "./persist";

const COUNT = 10;

function stylePrompt(style: string, index: number) {
  return [
    "Photorealistic full-length 9:16 photograph of the same person as the reference image.",
    "Do not change the person at all. No changes to the face, hair, hairline, expression, pout, eyes, skin, or identity. Match the reference exactly.",
    "They are standing in a clean, strong, bold stance on a plain white studio background.",
    "Arms are fully visible. Legs are fully visible, head to toe.",
    "No props, no furniture, no text, no watermark, and no other elements in the frame. Just them standing there.",
    `The only change is their clothing and styling: ${style}.`,
    `Outfit variation ${index + 1} of ${COUNT}, same face, hair, expression, stance, and white studio. Different garment details only.`,
  ].join(" ");
}

async function oneImage(imageUrl: string, style: string, index: number, userId: string) {
  const res = await fetch(`${env.openrouterBaseUrl.replace(/\/$/, "")}/images`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openrouterApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.openrouterImageModel,
      prompt: stylePrompt(style, index),
      aspect_ratio: "9:16",
      resolution: "1K",
      quality: "low",
      n: 1,
      input_references: [{ type: "image_url", image_url: { url: imageUrl } }],
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    data?: { b64_json?: string; media_type?: string }[];
  };
  if (!res.ok) {
    const message = data.error?.message || `OpenRouter image error ${res.status}`;
    throw new AppError(ERROR_CODES.GENERATION_FAILED, 502, message);
  }
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    throw new AppError(ERROR_CODES.GENERATION_FAILED, 502, "OpenRouter returned no image.");
  }
  const mediaType = data.data?.[0]?.media_type ?? "image/jpeg";
  const ext = mediaType.includes("png") ? "png" : mediaType.includes("webp") ? "webp" : "jpg";
  const buffer = Buffer.from(b64, "base64");
  const url = await persistPublicFile(`style-${userId}-${Date.now()}-${index}.${ext}`, buffer);
  return url;
}

export async function generateStyleImages(input: {
  imageUrl: string;
  style: string;
  userId: string;
}) {
  if (!env.openrouterApiKey) {
    throw new AppError(
      ERROR_CODES.GENERATION_FAILED,
      500,
      "OpenRouter isn’t configured. Add OPENROUTER_API_KEY and restart the API.",
    );
  }

  const jobs = Array.from({ length: COUNT }, (_, index) => index);
  const urls: string[] = [];
  let firstError: string | null = null;
  const limit = 4;
  let cursor = 0;

  async function worker() {
    while (cursor < jobs.length) {
      const index = cursor++;
      try {
        urls.push(await oneImage(input.imageUrl, input.style, index, input.userId));
      } catch (error) {
        if (!firstError) {
          firstError = error instanceof Error ? error.message : "Style image failed.";
        }
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  if (urls.length === 0) {
    throw new AppError(
      ERROR_CODES.GENERATION_FAILED,
      502,
      firstError ?? "Couldn’t generate style images.",
    );
  }
  return urls;
}
