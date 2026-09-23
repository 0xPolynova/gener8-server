import { createSupabaseAdmin } from "@/lib/supabase/admin";

const FILE = "library/kols.json";

export type LibraryKol = {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  status: "pending" | "approved" | "denied";
  submittedBy: string;
  createdAt: string;
};

export async function readKolLibrary(): Promise<LibraryKol[]> {
  const client = createSupabaseAdmin();
  if (!client) return [];
  const { data, error } = await client.storage.from("videos").download(FILE);
  if (error || !data) return [];
  try {
    const parsed = JSON.parse(await data.text()) as LibraryKol[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function writeKolLibrary(rows: LibraryKol[]) {
  const client = createSupabaseAdmin();
  if (!client) throw new Error("Supabase is not configured.");
  const body = Buffer.from(JSON.stringify(rows));
  const { error } = await client.storage.from("videos").upload(FILE, body, {
    contentType: "application/json",
    upsert: true,
  });
  if (error) throw error;
}
