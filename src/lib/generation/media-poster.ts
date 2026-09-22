import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

function ffmpegBin() {
  if (!ffmpegPath) throw new Error("ffmpeg-static is not available");
  return ffmpegPath;
}

function run(bin: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-2000) || `ffmpeg exited ${code}`));
    });
  });
}

/**
 * Pull a JPEG poster and remux the MP4 so `moov` is at the front.
 * Browsers can then paint metadata / the first frame without downloading
 * the whole file — feed hover and My Creations stay on the still.
 */
export async function extractPosterAndFaststart(input: Buffer) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gener8-poster-"));
  const src = path.join(dir, "in.mp4");
  const dest = path.join(dir, "out.mp4");
  const thumb = path.join(dir, "thumb.jpg");
  try {
    await fs.writeFile(src, input);
    const bin = ffmpegBin();

    let thumbnail: Buffer | null = null;
    try {
      await run(bin, [
        "-y",
        "-ss",
        "0.4",
        "-i",
        src,
        "-frames:v",
        "1",
        "-vf",
        "scale=720:-2",
        "-q:v",
        "5",
        thumb,
      ]);
      thumbnail = await fs.readFile(thumb);
    } catch {
      thumbnail = null;
    }

    let video = input;
    try {
      await run(bin, [
        "-y",
        "-i",
        src,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        dest,
      ]);
      video = await fs.readFile(dest);
    } catch {
      video = input;
    }

    return { video, thumbnail };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
