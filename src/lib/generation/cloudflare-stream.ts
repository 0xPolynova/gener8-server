import { env } from "@/lib/config/env";
import { logger } from "@/lib/log";

type StreamResult = {
  uid?: string;
  thumbnail?: string;
  preview?: string;
  playback?: { hls?: string; dash?: string };
};

function token() {
  return env.cfStreamApiToken;
}

function account() {
  return env.cfAccountId;
}

export function cloudflareStreamConfigured() {
  return Boolean(token() && account());
}

export async function uploadStreamVideo(buffer: Buffer, filename: string) {
  if (!cloudflareStreamConfigured()) return null;
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)]), filename);
  const created = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account()}/stream`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token()}` },
      body: form,
    },
  );
  const body = (await created.json().catch(() => ({}))) as {
    success?: boolean;
    errors?: { message?: string }[];
    result?: StreamResult;
  };
  if (!created.ok || !body.success || !body.result?.uid) {
    logger.error("cloudflare stream upload failed", {
      status: created.status,
      message: body.errors?.[0]?.message || "no uid",
    });
    return null;
  }
  const uid = body.result.uid;
  const download = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account()}/stream/${uid}/downloads`,
    { method: "POST", headers: { Authorization: `Bearer ${token()}` } },
  );
  const downloadBody = (await download.json().catch(() => ({}))) as {
    result?: { default?: { url?: string } };
  };
  const videoUrl =
    downloadBody.result?.default?.url ||
    body.result.playback?.hls ||
    body.result.preview ||
    "";
  if (!videoUrl) return null;
  return {
    videoUrl,
    thumbnailUrl: body.result.thumbnail || null,
  };
}
