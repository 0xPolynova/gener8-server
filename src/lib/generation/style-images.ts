import { env } from "@/lib/config/env";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { persistPublicFile } from "./persist";

const COUNT = 5;

const LOOKS = [
  "a tighter top and a straighter jean, jewellery worn higher on the chest",
  "a looser tank, an open vest, and wider jeans, jewellery stacked lower",
  "sleeves or layers added over the base outfit, a different jean wash, fewer pieces of jewellery",
  "a cropped top and baggier jeans, jewellery spread across neck and wrists",
  "the vest worn closed, jeans cuffed, and a heavier jewellery arrangement",
];

function stylePrompt(style: string, index: number) {
  const look = LOOKS[index % LOOKS.length];
  return [
    "Edit the reference photo. This is a wardrobe change only, not a new person.",
    "The face must stay exactly the same. Do not change facial features, bone structure, eyes, eyebrows, nose, lips, pout, expression, skin, beard, or any mark on the face.",
    "Do not change the hair at all. Same hairline, length, color, texture, and style as the reference.",
    "Do not beautify, age, de-age, slim, or redraw the head.",
    "Photorealistic full-length 9:16 frame. Clean, strong, bold stance. Plain white studio background.",
    "Arms fully visible. Legs fully visible, head to toe.",
    "No props, no furniture, no text, no watermark, nothing else in the frame.",
    `Only the clothes change, following this style: ${style}.`,
    `Clothing variation ${index + 1} of ${COUNT}: ${look}.`,
    "Vary the garments only. The head must still match the reference exactly.",
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
      seed: 1100 + index * 137,
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
  const limit = COUNT;
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
