import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const LOGO_URL =
  "https://imagedelivery.net/evSvvg4gSrZmei5DvWV8Aw/f8f20a99-3659-4066-7e6b-b6aeb49e6a00/public";

function fontFile() {
  const candidates = [
    "C:\\Windows\\Fonts\\arialbd.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
  ];
  return candidates.find((file) => existsSync(file)) ?? "";
}

function escapeFilterPath(file: string) {
  return file.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
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
      else reject(new Error(stderr.slice(-1500) || `ffmpeg exited ${code}`));
    });
  });
}

async function playableSource(videoUrl: string) {
  try {
    const url = new URL(videoUrl);
    const stream =
      url.hostname.endsWith("cloudflarestream.com") || url.hostname.endsWith("videodelivery.net");
    if (!stream) return videoUrl;
    const uid = url.pathname.split("/").filter(Boolean)[0];
    if (!uid || url.pathname.includes("/downloads/")) return videoUrl;
    const mp4 = `${url.origin}/${uid}/downloads/default.mp4`;
    const head = await fetch(mp4, { method: "HEAD" });
    if (head.ok) return mp4;
  } catch {
    /* use the stored URL */
  }
  return videoUrl;
}

/** Bottom-left logo, “made with”, and gener8.fun burned into a downloaded MP4. */
export async function brandDownload(videoUrl: string) {
  if (!ffmpegPath) throw new Error("ffmpeg-static is not available");
  const source = await playableSource(videoUrl);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gener8-brand-"));
  const logo = path.join(dir, "logo.png");
  const out = path.join(dir, "out.mp4");
  try {
    const image = await fetch(LOGO_URL);
    if (!image.ok) throw new Error("Couldn't load the Gener8 logo.");
    await fs.writeFile(logo, Buffer.from(await image.arrayBuffer()));
    const font = fontFile();
    const text = font
      ? `,drawtext=fontfile='${escapeFilterPath(font)}':text='made with':x=28:y=H-70:fontsize=16:fontcolor=white,drawtext=fontfile='${escapeFilterPath(font)}':text='gener8.fun':x=28:y=H-46:fontsize=22:fontcolor=0xFFF176`
      : "";
    const filter = [
      "[1:v]scale=64:-1,format=rgba[lg]",
      `[0:v][lg]overlay=28:H-h-86:format=auto${text}`,
    ].join(";");
    await run(ffmpegPath, [
      "-y",
      "-i",
      source,
      "-i",
      logo,
      "-filter_complex",
      filter,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      out,
    ]);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
