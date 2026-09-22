import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreationsTab,
  DiscoverFilter,
  GenerationJob,
  PosterPalette,
  User,
  Video,
  VideoWithCreator,
} from "@/types";
import { nanoid } from "@/lib/utils";

const DEFAULT_POSTER: PosterPalette = {
  from: "#050505",
  via: "#16120a",
  to: "#2a2208",
  accent: "#FBE418",
};

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  avatar_palette: PosterPalette | null;
  x_handle: string | null;
  profile_complete: boolean | null;
  follower_count: number;
  following_count: number;
  created_at: string;
  wallets?: { address: string }[] | null;
};

type VideoRow = {
  id: string;
  user_id: string;
  prompt: string;
  public_prompt: boolean;
  title: string;
  video_url: string | null;
  thumbnail_url: string | null;
  poster: PosterPalette | null;
  model: string;
  aspect_ratio: string;
  duration: number;
  quality: string;
  status: string;
  visibility: string;
  created_at: string;
  published_at: string | null;
  provider: string;
  provider_job_id: string | null;
  views: number;
  likes: number;
  category: string | null;
  featured: boolean | null;
  grid_span: string | null;
  sort_order: number | null;
  seed: number | null;
  negative_prompt: string | null;
  camera_movement: string | null;
  prompt_adherence: number | null;
  creativity: number | null;
  error_message: string | null;
};

type JobRow = {
  id: string;
  user_id: string;
  video_id: string;
  status: string;
  progress: number;
  prompt: string;
  settings: GenerationJob["settings"];
  provider: string;
  provider_job_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
};

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio ?? "",
    avatarPalette: row.avatar_palette ?? DEFAULT_POSTER,
    avatarUrl: row.avatar_url ?? null,
    xHandle: row.x_handle ?? null,
    profileComplete: Boolean(row.profile_complete),
    walletAddress: row.wallets?.[0]?.address ?? null,
    followerCount: row.follower_count,
    followingCount: row.following_count,
    createdAt: row.created_at,
  };
}

function creatorPreview(creator: User) {
  return {
    id: creator.id,
    username: creator.username,
    displayName: creator.displayName,
    avatarPalette: creator.avatarPalette,
    avatarUrl: creator.avatarUrl ?? null,
    xHandle: creator.xHandle ?? null,
    walletAddress: creator.walletAddress,
  };
}

function mapVideo(row: VideoRow): Video {
  return {
    id: row.id,
    userId: row.user_id,
    prompt: row.prompt,
    publicPrompt: row.public_prompt,
    title: row.title,
    videoUrl: row.video_url ?? "",
    thumbnailUrl: row.thumbnail_url,
    poster: row.poster ?? DEFAULT_POSTER,
    model: row.model,
    aspectRatio: row.aspect_ratio as Video["aspectRatio"],
    duration: row.duration as Video["duration"],
    quality: row.quality as Video["quality"],
    status: row.status as Video["status"],
    visibility: row.visibility as Video["visibility"],
    createdAt: row.created_at,
    publishedAt: row.published_at,
    provider: row.provider,
    providerJobId: row.provider_job_id,
    views: row.views,
    likes: row.likes,
    category: (row.category ?? "experimental") as Video["category"],
    featured: Boolean(row.featured),
    gridSpan: (row.grid_span as Video["gridSpan"]) ?? "normal",
    sortOrder: row.sort_order ?? null,
    seed: row.seed,
    negativePrompt: row.negative_prompt ?? "",
    cameraMovement: (row.camera_movement as Video["cameraMovement"]) ?? "static",
    promptAdherence: row.prompt_adherence ?? 70,
    creativity: row.creativity ?? 50,
    errorMessage: row.error_message,
  };
}

const DISCOVER_ORDER_PATH = "meta/discover-order.json";

function orderByIds<T extends { id: string }>(list: T[], ids: string[]): T[] {
  const map = new Map(list.map((item) => [item.id, item]));
  const used = new Set<string>();
  const ordered: T[] = [];
  for (const id of ids) {
    const item = map.get(id);
    if (item) {
      ordered.push(item);
      used.add(id);
    }
  }
  for (const item of list) {
    if (!used.has(item.id)) ordered.push(item);
  }
  return ordered;
}

function sortByDiscoverOrder<T extends { sortOrder?: number | null; likes: number; views: number }>(
  list: T[],
) {
  list.sort((a, b) => {
    const aHas = typeof a.sortOrder === "number";
    const bHas = typeof b.sortOrder === "number";
    if (aHas && bHas && a.sortOrder !== b.sortOrder) {
      return (a.sortOrder as number) - (b.sortOrder as number);
    }
    if (aHas !== bHas) return aHas ? -1 : 1;
    return b.likes + b.views / 8 - (a.likes + a.views / 8);
  });
}

async function loadDiscoverOrder(sb: SupabaseClient): Promise<string[] | null> {
  const { data, error } = await sb.storage.from("videos").download(DISCOVER_ORDER_PATH);
  if (error || !data) return null;
  try {
    const parsed = JSON.parse(await data.text()) as { ids?: unknown };
    return Array.isArray(parsed.ids)
      ? parsed.ids.filter((id): id is string => typeof id === "string")
      : null;
  } catch {
    return null;
  }
}

function mapJob(row: JobRow): GenerationJob {
  return {
    id: row.id,
    userId: row.user_id,
    videoId: row.video_id,
    status: row.status as GenerationJob["status"],
    progress: row.progress,
    prompt: row.prompt,
    settings: row.settings,
    provider: row.provider,
    providerJobId: row.provider_job_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function videoInsert(video: Video) {
  const row: Record<string, unknown> = {
    id: video.id,
    user_id: video.userId,
    prompt: video.prompt,
    public_prompt: video.publicPrompt,
    title: video.title,
    video_url: video.videoUrl || null,
    thumbnail_url: video.thumbnailUrl,
    poster: video.poster,
    model: video.model,
    aspect_ratio: video.aspectRatio,
    duration: video.duration,
    quality: video.quality,
    status: video.status,
    visibility: video.visibility,
    created_at: video.createdAt,
    published_at: video.publishedAt,
    provider: video.provider,
    provider_job_id: video.providerJobId,
    views: video.views,
    likes: video.likes,
    category: video.category,
    featured: Boolean(video.featured),
    grid_span: video.gridSpan ?? "normal",
    seed: video.seed ?? null,
    negative_prompt: video.negativePrompt ?? "",
    camera_movement: video.cameraMovement ?? "static",
    prompt_adherence: video.promptAdherence ?? 70,
    creativity: video.creativity ?? 50,
    error_message: video.errorMessage ?? null,
  };
  if (typeof video.sortOrder === "number") {
    row.sort_order = video.sortOrder;
  }
  return row;
}

function videoPatch(patch: Partial<Video>) {
  const row: Record<string, unknown> = {};
  if (patch.prompt !== undefined) row.prompt = patch.prompt;
  if (patch.publicPrompt !== undefined) row.public_prompt = patch.publicPrompt;
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.videoUrl !== undefined) row.video_url = patch.videoUrl || null;
  if (patch.thumbnailUrl !== undefined) row.thumbnail_url = patch.thumbnailUrl;
  if (patch.poster !== undefined) row.poster = patch.poster;
  if (patch.model !== undefined) row.model = patch.model;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.visibility !== undefined) row.visibility = patch.visibility;
  if (patch.publishedAt !== undefined) row.published_at = patch.publishedAt;
  if (patch.providerJobId !== undefined) row.provider_job_id = patch.providerJobId;
  if (patch.views !== undefined) row.views = patch.views;
  if (patch.likes !== undefined) row.likes = patch.likes;
  if (patch.errorMessage !== undefined) row.error_message = patch.errorMessage;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
  return row;
}

const USER_SELECT = "*, wallets(address)";

async function loadUser(sb: SupabaseClient, id: string) {
  const { data, error } = await sb.from("users").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: wallets } = await sb
    .from("wallets")
    .select("address")
    .eq("user_id", id);
  return mapUser({ ...(data as UserRow), wallets: wallets ?? [] });
}

async function withCreator(
  sb: SupabaseClient,
  video: Video,
  viewerId?: string | null,
): Promise<VideoWithCreator> {
  const creator = await loadUser(sb, video.userId);
  if (!creator) throw new Error(`Missing creator for video ${video.id}`);
  let likedByMe = false;
  if (viewerId) {
    const { data } = await sb
      .from("likes")
      .select("id")
      .eq("user_id", viewerId)
      .eq("video_id", video.id)
      .maybeSingle();
    likedByMe = Boolean(data);
  }
  return {
    ...video,
    creator: creatorPreview(creator),
    likedByMe,
  };
}

export async function sbGetUser(sb: SupabaseClient, id: string) {
  return loadUser(sb, id);
}

export async function sbGetUserByUsername(sb: SupabaseClient, username: string) {
  const { data, error } = await sb
    .from("users")
    .select("*")
    .ilike("username", username)
    .maybeSingle();
  if (error) throw error;
  return data ? mapUser(data as UserRow) : null;
}

export async function sbGetUserByWallet(sb: SupabaseClient, address: string) {
  const { data: wallet, error } = await sb
    .from("wallets")
    .select("user_id")
    .ilike("address", address)
    .maybeSingle();
  if (error) throw error;
  if (!wallet?.user_id) return null;
  return loadUser(sb, wallet.user_id);
}

export async function sbUpsertUserFromWallet(sb: SupabaseClient, address: string) {
  const existing = await sbGetUserByWallet(sb, address);
  if (existing) return existing;

  const short = address.slice(0, 4).toLowerCase();
  const username = `anon_${short}${address.slice(-2).toLowerCase()}`;
  const id = `usr_${nanoid(8)}`;
  const now = new Date().toISOString();
  const { error: userError } = await sb.from("users").insert({
    id,
    username,
    display_name: username,
    bio: "",
    avatar_palette: DEFAULT_POSTER,
    profile_complete: false,
    follower_count: 0,
    following_count: 0,
    created_at: now,
  });
  if (userError) throw userError;
  const { error: walletError } = await sb.from("wallets").insert({
    id: `wal_${nanoid(8)}`,
    user_id: id,
    address,
    chain: "solana",
    created_at: now,
  });
  if (walletError) throw walletError;
  const user = await loadUser(sb, id);
  if (!user) throw new Error("Failed to create user");
  return user;
}

export async function sbListDiscover(
  sb: SupabaseClient,
  filter: DiscoverFilter,
  viewerId?: string | null,
) {
  let query = sb
    .from("videos")
    .select("*")
    .eq("visibility", "public")
    .eq("status", "complete");

  if (filter === "following") {
    if (!viewerId) return [];
    const { data: follows } = await sb
      .from("follows")
      .select("following_id")
      .eq("follower_id", viewerId);
    const ids = (follows ?? []).map((f) => f.following_id);
    if (!ids.length) return [];
    query = query.in("user_id", ids);
  } else if (
    filter !== "trending" &&
    filter !== "latest" &&
    filter !== "viral"
  ) {
    query = query.eq("category", filter);
  }

  const { data, error } = await query;
  if (error) throw error;
  let list = (data as VideoRow[]).map(mapVideo);

  if (filter === "latest") {
    list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  } else if (filter === "trending") {
    const custom = await loadDiscoverOrder(sb);
    if (custom?.length) list = orderByIds(list, custom);
    else sortByDiscoverOrder(list);
  } else if (filter === "following") {
    list.sort((a, b) => b.likes + b.views / 8 - (a.likes + a.views / 8));
  } else if (filter === "viral") {
    list.sort((a, b) => b.views - a.views || b.likes - a.likes);
  }

  if (filter !== "trending" && filter !== "latest") {
    list = list.map((v) => ({ ...v, gridSpan: "normal" as const }));
  }

  return Promise.all(list.map((v) => withCreator(sb, v, viewerId)));
}

export async function sbGetVideo(
  sb: SupabaseClient,
  id: string,
  viewerId?: string | null,
) {
  const { data, error } = await sb.from("videos").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return withCreator(sb, mapVideo(data as VideoRow), viewerId);
}

export async function sbListUserVideos(
  sb: SupabaseClient,
  userId: string,
  tab: CreationsTab = "all",
) {
  let query = sb.from("videos").select("*").eq("user_id", userId);
  if (tab === "published") query = query.eq("visibility", "public");
  if (tab === "private") query = query.eq("visibility", "private");
  if (tab === "generating") {
    query = query.in("status", ["queued", "preparing", "generating", "processing"]);
  }
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;
  return (data as VideoRow[]).map(mapVideo);
}

export async function sbListPublicByUsername(
  sb: SupabaseClient,
  username: string,
  viewerId?: string | null,
) {
  const user = await sbGetUserByUsername(sb, username);
  if (!user) return { user: null, videos: [] as VideoWithCreator[] };
  const { data, error } = await sb
    .from("videos")
    .select("*")
    .eq("user_id", user.id)
    .eq("visibility", "public")
    .eq("status", "complete")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const videos = await Promise.all(
    (data as VideoRow[]).map((row) => withCreator(sb, mapVideo(row), viewerId)),
  );
  return { user, videos };
}

export async function sbCreateVideo(sb: SupabaseClient, video: Video) {
  const row = videoInsert(video);
  let { error } = await sb.from("videos").insert(row);
  if (error && /sort_order|schema cache/i.test(error.message ?? "")) {
    delete row.sort_order;
    ({ error } = await sb.from("videos").insert(row));
  }
  if (error) throw error;
  return video;
}

export async function sbUpdateVideo(
  sb: SupabaseClient,
  id: string,
  patch: Partial<Video>,
) {
  const { error } = await sb.from("videos").update(videoPatch(patch)).eq("id", id);
  if (error) throw error;
  const { data } = await sb.from("videos").select("*").eq("id", id).maybeSingle();
  return data ? mapVideo(data as VideoRow) : null;
}

export async function sbDeleteVideo(sb: SupabaseClient, id: string, userId: string) {
  const { data } = await sb
    .from("videos")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return false;
  const { error } = await sb.from("videos").delete().eq("id", id);
  if (error) throw error;
  return true;
}

export async function sbCreateJob(sb: SupabaseClient, job: GenerationJob) {
  const { error } = await sb.from("generation_jobs").insert({
    id: job.id,
    user_id: job.userId,
    video_id: job.videoId,
    status: job.status,
    progress: job.progress,
    prompt: job.prompt,
    settings: job.settings,
    provider: job.provider,
    provider_job_id: job.providerJobId,
    error_code: job.errorCode,
    error_message: job.errorMessage,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    started_at: job.startedAt,
    completed_at: job.completedAt,
  });
  if (error) throw error;
  return job;
}

export async function sbGetJob(sb: SupabaseClient, id: string) {
  const { data, error } = await sb
    .from("generation_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapJob(data as JobRow) : null;
}

export async function sbGetJobByVideoId(sb: SupabaseClient, videoId: string) {
  const { data, error } = await sb
    .from("generation_jobs")
    .select("*")
    .eq("video_id", videoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapJob(data as JobRow) : null;
}

export async function sbListJobsForUser(sb: SupabaseClient, userId: string) {
  const { data, error } = await sb
    .from("generation_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as JobRow[]).map(mapJob);
}

export async function sbUpdateJob(
  sb: SupabaseClient,
  id: string,
  patch: Partial<GenerationJob>,
) {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.progress !== undefined) row.progress = patch.progress;
  if (patch.providerJobId !== undefined) row.provider_job_id = patch.providerJobId;
  if (patch.errorCode !== undefined) row.error_code = patch.errorCode;
  if (patch.errorMessage !== undefined) row.error_message = patch.errorMessage;
  if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
  if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
  const { error } = await sb.from("generation_jobs").update(row).eq("id", id);
  if (error) throw error;
  return sbGetJob(sb, id);
}

export async function sbToggleLike(sb: SupabaseClient, userId: string, videoId: string) {
  const { data: existing } = await sb
    .from("likes")
    .select("id")
    .eq("user_id", userId)
    .eq("video_id", videoId)
    .maybeSingle();
  const { data: video } = await sb
    .from("videos")
    .select("likes")
    .eq("id", videoId)
    .maybeSingle();
  if (!video) return { liked: false, likes: 0 };

  if (existing) {
    await sb.from("likes").delete().eq("id", existing.id);
    const likes = Math.max(0, (video.likes as number) - 1);
    await sb.from("videos").update({ likes }).eq("id", videoId);
    return { liked: false, likes };
  }

  await sb.from("likes").insert({
    id: `like_${nanoid(8)}`,
    user_id: userId,
    video_id: videoId,
  });
  const likes = (video.likes as number) + 1;
  await sb.from("videos").update({ likes }).eq("id", videoId);
  return { liked: true, likes };
}

export async function sbRecordView(
  sb: SupabaseClient,
  videoId: string,
  userId: string | null,
) {
  await sb.from("views").insert({
    id: `view_${nanoid(10)}`,
    video_id: videoId,
    user_id: userId,
  });
  const { data: video } = await sb
    .from("videos")
    .select("views")
    .eq("id", videoId)
    .maybeSingle();
  const views = (video?.views ?? 0) + 1;
  await sb.from("videos").update({ views }).eq("id", videoId);
  return views;
}

export async function sbToggleFollow(
  sb: SupabaseClient,
  followerId: string,
  username: string,
) {
  const target = await sbGetUserByUsername(sb, username);
  if (!target) return null;
  if (target.id === followerId) {
    return { following: false, followerCount: target.followerCount };
  }
  const { data: existing } = await sb
    .from("follows")
    .select("id")
    .eq("follower_id", followerId)
    .eq("following_id", target.id)
    .maybeSingle();

  if (existing) {
    await sb.from("follows").delete().eq("id", existing.id);
    const followerCount = Math.max(0, target.followerCount - 1);
    await sb.from("users").update({ follower_count: followerCount }).eq("id", target.id);
    const me = await loadUser(sb, followerId);
    if (me) {
      await sb
        .from("users")
        .update({ following_count: Math.max(0, me.followingCount - 1) })
        .eq("id", followerId);
    }
    return { following: false, followerCount };
  }

  await sb.from("follows").insert({
    id: `fol_${nanoid(8)}`,
    follower_id: followerId,
    following_id: target.id,
  });
  const followerCount = target.followerCount + 1;
  await sb.from("users").update({ follower_count: followerCount }).eq("id", target.id);
  const me = await loadUser(sb, followerId);
  if (me) {
    await sb
      .from("users")
      .update({ following_count: me.followingCount + 1 })
      .eq("id", followerId);
  }
  return { following: true, followerCount };
}

export async function sbIsFollowing(
  sb: SupabaseClient,
  followerId: string,
  userId: string,
) {
  const { data } = await sb
    .from("follows")
    .select("id")
    .eq("follower_id", followerId)
    .eq("following_id", userId)
    .maybeSingle();
  return Boolean(data);
}

export async function sbGetDailyCount(sb: SupabaseClient, userId: string) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count, error } = await sb
    .from("generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", start.toISOString());
  if (error) throw error;
  return count ?? 0;
}

export async function sbIncrementDaily(sb: SupabaseClient, userId: string) {
  // Job insert is the source of truth; this exists for the memory-store API.
  return sbGetDailyCount(sb, userId);
}

export async function sbUserStats(sb: SupabaseClient, userId: string) {
  const { data, error } = await sb
    .from("videos")
    .select("visibility, views, status")
    .eq("user_id", userId)
    .eq("status", "complete");
  if (error) throw error;
  const vids = data ?? [];
  const published = vids.filter((v) => v.visibility === "public");
  return {
    totalCreations: vids.length,
    publishedCount: published.length,
    totalViews: published.reduce((sum, v) => sum + (v.views as number), 0),
  };
}

async function ensureAvatarsBucket(sb: SupabaseClient) {
  const { data } = await sb.storage.getBucket("avatars");
  if (data) return;
  const { error } = await sb.storage.createBucket("avatars", {
    public: true,
    fileSizeLimit: "4194304",
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

export async function sbUploadAvatar(
  sb: SupabaseClient,
  userId: string,
  file: { buffer: Buffer; mimetype: string },
) {
  await ensureAvatarsBucket(sb);
  const ext =
    file.mimetype === "image/webp"
      ? "webp"
      : file.mimetype === "image/png"
        ? "png"
        : "jpg";
  const path = `${userId}/avatar.${ext}`;
  const { error } = await sb.storage.from("avatars").upload(path, file.buffer, {
    contentType: file.mimetype,
    upsert: true,
  });
  if (error) throw error;
  const { data } = sb.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

async function ensureVideosBucket(sb: SupabaseClient) {
  const { data } = await sb.storage.getBucket("videos");
  if (data) {
    const { error } = await sb.storage.updateBucket("videos", {
      public: true,
      fileSizeLimit: "104857600",
    });
    if (error) {
      console.warn("[gener8] could not raise videos bucket size", error.message);
    }
    return;
  }
  const { error } = await sb.storage.createBucket("videos", {
    public: true,
    fileSizeLimit: "104857600",
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

function contentTypeForUpload(key: string) {
  if (/\.jpe?g$/i.test(key)) return "image/jpeg";
  if (/\.png$/i.test(key)) return "image/png";
  if (/\.webp$/i.test(key)) return "image/webp";
  if (/\.gif$/i.test(key)) return "image/gif";
  return "video/mp4";
}

export async function sbUploadGeneratedVideo(
  sb: SupabaseClient,
  key: string,
  buffer: Buffer,
) {
  await ensureVideosBucket(sb);
  const pathName = key.replace(/^\/+/, "");
  const { error } = await sb.storage.from("videos").upload(pathName, buffer, {
    contentType: contentTypeForUpload(pathName),
    upsert: true,
  });
  if (error) throw error;
  const { data } = sb.storage.from("videos").getPublicUrl(pathName);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function sbReorderDiscover(sb: SupabaseClient, ids: string[]) {
  await ensureVideosBucket(sb);
  const body = Buffer.from(JSON.stringify({ ids }), "utf8");
  const { error: uploadError } = await sb.storage
    .from("videos")
    .upload(DISCOVER_ORDER_PATH, body, {
      contentType: "application/json",
      upsert: true,
    });
  if (uploadError) throw uploadError;

  const results = await Promise.all(
    ids.map((id, index) =>
      sb.from("videos").update({ sort_order: index }).eq("id", id),
    ),
  );
  const columnMissing = results.some((result) =>
    /sort_order|schema cache/i.test(result.error?.message ?? ""),
  );
  if (columnMissing) {
    console.warn("[gener8] videos.sort_order is missing — layout saved to storage only");
  }
}

export async function sbCompleteProfile(
  sb: SupabaseClient,
  userId: string,
  patch: {
    username: string;
    displayName: string;
    xHandle: string | null;
    avatarUrl?: string | null;
  },
) {
  const taken = await sbGetUserByUsername(sb, patch.username);
  if (taken && taken.id !== userId) {
    const error = new Error("USERNAME_TAKEN");
    error.name = "USERNAME_TAKEN";
    throw error;
  }
  const row: Record<string, unknown> = {
    username: patch.username,
    display_name: patch.displayName,
    x_handle: patch.xHandle,
    profile_complete: true,
  };
  if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl;
  const { data, error } = await sb
    .from("users")
    .update(row)
    .eq("id", userId)
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      const takenError = new Error("USERNAME_TAKEN");
      takenError.name = "USERNAME_TAKEN";
      throw takenError;
    }
    throw error;
  }
  if (!data) return null;
  const { data: wallets } = await sb
    .from("wallets")
    .select("address")
    .eq("user_id", userId);
  return mapUser({ ...(data as UserRow), wallets: wallets ?? [] });
}
