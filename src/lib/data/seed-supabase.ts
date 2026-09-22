import type { SupabaseClient } from "@supabase/supabase-js";
import { seedFollows, seedUsers, seedVideos } from "./seed";
import { videoInsert } from "./supabase";

async function upsertExampleFeed(sb: SupabaseClient) {
  const creator = seedUsers.find((user) => user.id === "usr_examples");
  const videos = seedVideos.filter((video) => video.provider === "cloudflare");
  if (!creator || videos.length === 0) return;

  const { data: existingUser, error: userLookupError } = await sb
    .from("users")
    .select("id")
    .eq("id", creator.id)
    .maybeSingle();
  if (userLookupError) throw userLookupError;
  if (!existingUser) {
    const { error: userError } = await sb.from("users").insert({
      id: creator.id,
      username: creator.username,
      display_name: creator.displayName,
      bio: creator.bio,
      avatar_palette: creator.avatarPalette,
      avatar_url: creator.avatarUrl ?? null,
      x_handle: creator.xHandle ?? null,
      profile_complete: true,
      follower_count: creator.followerCount,
      following_count: creator.followingCount,
      created_at: creator.createdAt,
    });
    if (userError) throw userError;
  }

  const { data: existingVideos, error: videoLookupError } = await sb
    .from("videos")
    .select("id")
    .in(
      "id",
      videos.map((video) => video.id),
    );
  if (videoLookupError) throw videoLookupError;
  const have = new Set((existingVideos ?? []).map((row) => row.id as string));
  const missing = videos.filter((video) => !have.has(video.id));
  if (missing.length) {
    const { error: videoError } = await sb
      .from("videos")
      .insert(missing.map(videoInsert));
    if (videoError) throw videoError;
  }
}

export async function seedSupabase(sb: SupabaseClient) {
  const { count } = await sb
    .from("users")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) {
    await upsertExampleFeed(sb);
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

  await upsertExampleFeed(sb);

  return {
    skipped: false,
    users: seedUsers.length,
    videos: seedVideos.length,
    follows: seedFollows.length,
  };
}
