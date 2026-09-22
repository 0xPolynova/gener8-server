import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreationsTab,
  DiscoverFilter,
  GenerationJob,
  Video,
} from "@/types";
import { isSupabaseConfigured } from "@/lib/config/env";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { seedSupabase } from "./seed-supabase";
import { store } from "./store";
import * as sb from "./supabase";

let readyClient: SupabaseClient | null = null;
let seedPromise: Promise<void> | null = null;
let lastMissAt = 0;
const MISS_COOLDOWN_MS = 15_000;

function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "PGRST205" ||
    /schema cache|could not find the table/i.test(error.message ?? "")
  );
}

async function admin() {
  if (readyClient) return readyClient;
  if (!isSupabaseConfigured()) return null;
  if (Date.now() - lastMissAt < MISS_COOLDOWN_MS) return null;
  const client = createSupabaseAdmin();
  if (!client) return null;

  const { error } = await client.from("users").select("id").limit(1);
  if (error) {
    lastMissAt = Date.now();
    if (!isMissingTable(error)) {
      console.error("[gener8] supabase ping failed:", error.message);
      if (/permission denied/i.test(error.message ?? "")) {
        console.error(
          "[gener8] Run supabase/grants.sql in the Supabase SQL editor, then restart the API.",
        );
      }
    }
    return null;
  }

  if (!seedPromise) {
    seedPromise = seedSupabase(client)
      .then((result) => {
        if (!result.skipped) {
          console.info("[gener8] seeded supabase", result);
        }
      })
      .catch((seedError) => {
        seedPromise = null;
        console.error("[gener8] supabase seed failed:", seedError);
      });
  }
  await seedPromise;

  readyClient = client;
  return client;
}

/**
 * Data access boundary.
 * Uses Supabase when the project is reachable with tables applied;
 * otherwise the in-memory store.
 */
export const db = {
  configured: isSupabaseConfigured(),

  async listDiscover(filter: DiscoverFilter, viewerId?: string | null) {
    const client = await admin();
    if (client) return sb.sbListDiscover(client, filter, viewerId);
    return store.listDiscover(filter, viewerId);
  },

  async getVideo(id: string, viewerId?: string | null) {
    const client = await admin();
    if (client) return sb.sbGetVideo(client, id, viewerId);
    return store.getVideo(id, viewerId);
  },

  async listUserVideos(userId: string, tab?: CreationsTab) {
    const client = await admin();
    if (client) return sb.sbListUserVideos(client, userId, tab);
    return store.listUserVideos(userId, tab);
  },

  async listPublicByUsername(username: string, viewerId?: string | null) {
    const client = await admin();
    if (client) return sb.sbListPublicByUsername(client, username, viewerId);
    return store.listPublicByUsername(username, viewerId);
  },

  async getUserByUsername(username: string) {
    const client = await admin();
    if (client) return sb.sbGetUserByUsername(client, username);
    return store.getUserByUsername(username);
  },

  async getUser(id: string) {
    const client = await admin();
    if (client) return sb.sbGetUser(client, id);
    return store.getUser(id);
  },

  async getUserByWallet(address: string) {
    const client = await admin();
    if (client) return sb.sbGetUserByWallet(client, address);
    return store.getUserByWallet(address);
  },

  async upsertUserFromWallet(address: string) {
    const client = await admin();
    if (client) return sb.sbUpsertUserFromWallet(client, address);
    return store.upsertUserFromWallet(address);
  },

  async createVideo(video: Video) {
    const client = await admin();
    if (client) return sb.sbCreateVideo(client, video);
    return store.createVideo(video);
  },

  async updateVideo(id: string, patch: Partial<Video>) {
    const client = await admin();
    if (client) return sb.sbUpdateVideo(client, id, patch);
    return store.updateVideo(id, patch);
  },

  async reorderDiscover(ids: string[]) {
    const client = await admin();
    if (client) return sb.sbReorderDiscover(client, ids);
    return store.reorderDiscover(ids);
  },

  async deleteVideo(id: string, userId: string) {
    const client = await admin();
    if (client) return sb.sbDeleteVideo(client, id, userId);
    return store.deleteVideo(id, userId);
  },

  async createJob(job: GenerationJob) {
    const client = await admin();
    if (client) return sb.sbCreateJob(client, job);
    return store.createJob(job);
  },

  async getJob(id: string) {
    const client = await admin();
    if (client) return sb.sbGetJob(client, id);
    return store.getJob(id);
  },

  async getJobByVideoId(videoId: string) {
    const client = await admin();
    if (client) return sb.sbGetJobByVideoId(client, videoId);
    return store.getJobByVideoId(videoId);
  },

  async listJobsForUser(userId: string) {
    const client = await admin();
    if (client) return sb.sbListJobsForUser(client, userId);
    return store.listJobsForUser(userId);
  },

  async updateJob(id: string, patch: Partial<GenerationJob>) {
    const client = await admin();
    if (client) return sb.sbUpdateJob(client, id, patch);
    return store.updateJob(id, patch);
  },

  async toggleLike(userId: string, videoId: string) {
    const client = await admin();
    if (client) return sb.sbToggleLike(client, userId, videoId);
    return store.toggleLike(userId, videoId);
  },

  async recordView(videoId: string, userId: string | null) {
    const client = await admin();
    if (client) return sb.sbRecordView(client, videoId, userId);
    return store.recordView(videoId, userId);
  },

  async toggleFollow(followerId: string, username: string) {
    const client = await admin();
    if (client) return sb.sbToggleFollow(client, followerId, username);
    return store.toggleFollow(followerId, username);
  },

  async isFollowing(followerId: string, userId: string) {
    const client = await admin();
    if (client) return sb.sbIsFollowing(client, followerId, userId);
    return store.isFollowing(followerId, userId);
  },

  async incrementDaily(userId: string) {
    const client = await admin();
    if (client) return sb.sbIncrementDaily(client, userId);
    return store.incrementDaily(userId);
  },

  async getDailyCount(userId: string) {
    const client = await admin();
    if (client) return sb.sbGetDailyCount(client, userId);
    return store.getDailyCount(userId);
  },

  async userStats(userId: string) {
    const client = await admin();
    if (client) return sb.sbUserStats(client, userId);
    return store.userStats(userId);
  },

  async uploadAvatar(
    userId: string,
    file: { buffer: Buffer; mimetype: string },
  ) {
    const client = await admin();
    if (client) return sb.sbUploadAvatar(client, userId, file);
    return null;
  },

  async uploadGeneratedVideo(key: string, buffer: Buffer) {
    const client = await admin();
    if (client) {
      try {
        return await sb.sbUploadGeneratedVideo(client, key, buffer);
      } catch (error) {
        console.error("[gener8] video upload to supabase failed", error);
      }
    }
    return null;
  },

  async completeProfile(
    userId: string,
    patch: {
      username: string;
      displayName: string;
      xHandle: string | null;
      avatarUrl?: string | null;
    },
  ) {
    const client = await admin();
    if (client) {
      const existing = await sb.sbGetUser(client, userId).catch(() => null);
      if (existing) return sb.sbCompleteProfile(client, userId, patch);
    }
    return store.completeProfile(userId, patch);
  },
};
