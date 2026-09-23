import { env } from "@/lib/config/env";
import { logger } from "@/lib/log";

export function bunnyConfigured() {
  return Boolean(env.bunnyStorageZone && env.bunnyStorageAccessKey && env.bunnyCdnUrl);
}

function storageHost() {
  const region = env.bunnyStorageRegion.trim().toLowerCase();
  if (!region || region === "de" || region === "falkenstein") return "storage.bunnycdn.com";
  return `${region}.storage.bunnycdn.com`;
}

export async function uploadBunny(key: string, body: Buffer, contentType: string) {
  const objectKey = key.replace(/^\/+/, "");
  const endpoint = `https://${storageHost()}/${env.bunnyStorageZone}/${objectKey}`;
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      AccessKey: env.bunnyStorageAccessKey,
      "Content-Type": contentType,
    },
    body,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    logger.error("bunny upload failed", { status: response.status, detail: detail.slice(0, 200) });
    throw new Error(`Bunny upload failed (${response.status}).`);
  }
  return `${env.bunnyCdnUrl.replace(/\/$/, "")}/${objectKey}`;
}
