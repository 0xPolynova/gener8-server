import fs from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/config/env";
import { db } from "@/lib/data/repository";
import { uploadStreamVideo } from "./cloudflare-stream";
import { extractPosterAndFaststart } from "./media-poster";
import { bunnyConfigured, uploadBunny } from "@/lib/storage/bunny";

export async function persistPublicFile(key: string, buffer: Buffer) {
  const uploaded = await db.uploadGeneratedVideo(key, buffer);
  if (uploaded) return uploaded;

  const dir = path.join(process.cwd(), "uploads");
  await fs.mkdir(dir, { recursive: true });
  const file = key.replace(/[^a-zA-Z0-9._/-]/g, "_").replace(/\//g, "-");
  await fs.writeFile(path.join(dir, file), buffer);
  const origin =
    process.env.API_PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (env.nodeEnv === "production" ? env.appUrl : `http://127.0.0.1:${env.port}`);
  return `${origin.replace(/\/$/, "")}/uploads/${file}`;
}

export async function persistGeneratedVideo(jobId: string, buffer: Buffer) {
  return persistPublicFile(`${jobId}.mp4`, buffer);
}

export async function persistGeneratedClip(jobId: string, buffer: Buffer) {
  let video = buffer;
  let thumb: Buffer | null = null;
  try {
    const prepared = await extractPosterAndFaststart(buffer);
    video = prepared.video;
    thumb = prepared.thumbnail;
  } catch {
    /* keep the original bytes if ffmpeg can’t remux this file */
  }
  if (bunnyConfigured()) {
    const videoUrl = await uploadBunny(`videos/${jobId}.mp4`, video, "video/mp4");
    const thumbnailUrl = thumb
      ? await uploadBunny(`videos/${jobId}.jpg`, thumb, "image/jpeg")
      : null;
    return { videoUrl, thumbnailUrl };
  }
  const streamed = await uploadStreamVideo(video, `${jobId}.mp4`);
  if (streamed) {
    return {
      videoUrl: streamed.videoUrl,
      thumbnailUrl: streamed.thumbnailUrl ?? (thumb ? await persistPublicFile(`${jobId}.jpg`, thumb) : null),
    };
  }
  const videoUrl = await persistPublicFile(`${jobId}.mp4`, video);
  const thumbnailUrl = thumb
    ? await persistPublicFile(`${jobId}.jpg`, thumb)
    : null;
  return { videoUrl, thumbnailUrl };
}

export async function rehostOrKeep(jobId: string, remoteUrl: string) {
  try {
    const download = await fetch(remoteUrl);
    if (!download.ok) {
      return { videoUrl: remoteUrl, thumbnailUrl: null as string | null };
    }
    const buffer = Buffer.from(await download.arrayBuffer());
    return await persistGeneratedClip(jobId, buffer);
  } catch {
    return { videoUrl: remoteUrl, thumbnailUrl: null as string | null };
  }
}
