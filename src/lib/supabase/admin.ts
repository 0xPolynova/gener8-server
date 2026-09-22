import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/config/env";

export function createSupabaseAdmin(): SupabaseClient | null {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
