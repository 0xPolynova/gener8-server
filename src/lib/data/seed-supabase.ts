import type { SupabaseClient } from "@supabase/supabase-js";
import { seedFollows, seedUsers, seedVideos } from "./seed";
import { videoInsert } from "./supabase";

export async function seedSupabase(sb: SupabaseClient) {
  const { count } = await sb
    .from("users")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) {
    return { skipped: true, users: count ?? 0 };
  }

  const { error: userError } = await sb.from("users").insert(
    seedUsers.map((user) => ({
      id: user.id,
      username: user.username,
      display_name: user.displayName,
      bio: user.bio,
      avatar_palette: user.avatarPalette,
      avatar_url: user.avatarUrl ?? null,
      x_handle: user.xHandle ?? null,
      profile_complete: user.profileComplete !== false,
      follower_count: user.followerCount,
      following_count: user.followingCount,
      created_at: user.createdAt,
    })),
  );
  if (userError) throw userError;

  const { error: walletError } = await sb.from("wallets").insert(
    seedUsers
      .filter((user) => user.walletAddress)
      .map((user) => ({
        id: `wal_${user.id}`,
        user_id: user.id,
        address: user.walletAddress,
        chain: "solana",
        created_at: user.createdAt,
      })),
  );
  if (walletError) throw walletError;

  const { error: videoError } = await sb
    .from("videos")
    .insert(seedVideos.map(videoInsert));
  if (videoError) throw videoError;

  const { error: followError } = await sb.from("follows").insert(
    seedFollows.map((follow, i) => ({
      id: `fol_seed_${i}`,
      follower_id: follow.followerId,
      following_id: follow.followingId,
      created_at: new Date().toISOString(),
    })),
  );
  if (followError) throw followError;

  return {
    skipped: false,
    users: seedUsers.length,
    videos: seedVideos.length,
    follows: seedFollows.length,
  };
}
