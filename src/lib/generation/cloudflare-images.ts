import fs from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/config/env";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export function cloudflareImagesConfigured() {
  return Boolean(env.cfAccountId && env.cfImagesApiToken);
}

export async function uploadCloudflareImage(
  buffer: Buffer,
  filename: string,
  meta?: Record<string, string>,
) {
  if (!cloudflareImagesConfigured()) return null;
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)]), filename);
  if (meta) form.append("metadata", JSON.stringify(meta));
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.cfAccountId}/images/v1`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.cfImagesApiToken}` },
      body: form,
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    errors?: { message?: string }[];
    result?: { id?: string; variants?: string[] };
  };
  if (!res.ok || !data.success || !data.result?.id) {
    const message = data.errors?.[0]?.message || `Cloudflare Images error ${res.status}`;
    throw new Error(message);
  }
  const variant =
    data.result.variants?.find((url) => url.endsWith("/public")) ??
    data.result.variants?.[0] ??
    `https://imagedelivery.net/${env.cfImagesAccountHash}/${data.result.id}/public`;
  return { id: data.result.id, url: variant };
}

export async function readImageBytes(url: string) {
  const match = url.match(/\/uploads\/([^/?#]+)$/);
  if (match) {
    try {
      return await fs.readFile(path.join(process.cwd(), "uploads", match[1]));
    } catch {
      /* fall through to HTTP */
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn’t read the style image (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

export async function saveKolStyle(input: {
  kolId: string;
  handle: string;
  style: string;
  imageUrl: string;
  cfImageId: string | null;
  userId: string;
}) {
  const client = createSupabaseAdmin();
  if (!client) return false;
  const { error } = await client.from("kol_styles").insert({
    id: `style_${crypto.randomUUID()}`,
    kol_id: input.kolId,
    handle: input.handle,
    style_prompt: input.style,
    image_url: input.imageUrl,
    cf_image_id: input.cfImageId,
    user_id: input.userId,
  });
  if (error) {
    console.error("[gener8] kol style save failed", error.message);
    return false;
  }
  return true;
}

export async function listKolStyles(handle: string, cursor: string | null, limit: number) {
  if (cloudflareImagesConfigured()) return listKolStylesFromCdn(handle, cursor, limit);
  return listKolStylesFromDb(handle, cursor, limit);
}

async function listKolStylesFromCdn(handle: string, cursor: string | null, limit: number) {
  const wanted: { id: string; url: string; style: string }[] = [];
  let page = Math.max(1, Number(cursor) || 1);
  let more = true;
  const perPage = 50;
  while (wanted.length < limit && more && page < (Number(cursor) || 1) + 6) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.cfAccountId}/images/v1?page=${page}&per_page=${perPage}`,
      { headers: { Authorization: `Bearer ${env.cfImagesApiToken}` } },
    );
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      errors?: { message?: string }[];
      result?: { images?: { id?: string; filename?: string; meta?: Record<string, string>; variants?: string[] }[] };
      result_info?: { page?: number; total_count?: number };
    };
    if (!res.ok || !data.success) {
      throw new Error(data.errors?.[0]?.message || `Cloudflare Images list failed (${res.status}).`);
    }
    for (const image of data.result?.images ?? []) {
      const meta = image.meta ?? {};
      const tagged = meta.kind === "kol-style" && meta.handle === handle;
      const named = (image.filename ?? "").startsWith(`${handle}-style`);
      if (!tagged && !named) continue;
      const url =
        image.variants?.find((item) => item.endsWith("/public")) ??
        image.variants?.[0] ??
        `https://imagedelivery.net/${env.cfImagesAccountHash}/${image.id}/public`;
      if (image.id) wanted.push({ id: image.id, url, style: meta.style ?? "" });
    }
    const total = data.result_info?.total_count ?? 0;
    more = page * perPage < total;
    page += 1;
  }
  return {
    images: wanted.slice(0, limit),
    nextCursor: more ? String(page) : null,
  };
}

async function listKolStylesFromDb(handle: string, cursor: string | null, limit: number) {
  const client = createSupabaseAdmin();
  if (!client) return { images: [] as { id: string; url: string; style: string }[], nextCursor: null as string | null };
  let query = client
    .from("kol_styles")
    .select("id,image_url,style_prompt,created_at")
    .eq("handle", handle)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (cursor) query = query.lt("created_at", cursor);
  const { data, error } = await query;
  if (error || !data) {
    if (error) console.error("[gener8] kol style list failed", error.message);
    return { images: [], nextCursor: null };
  }
  const images = data.map((row) => ({
    id: String(row.id),
    url: String(row.image_url),
    style: String(row.style_prompt ?? ""),
  }));
  const nextCursor = data.length === limit ? String(data[data.length - 1].created_at) : null;
  return { images, nextCursor };
}
