import type {
  CreationsTab,
  DiscoverFilter,
  Follow,
  GenerationJob,
  Like,
  User,
  Video,
  VideoWithCreator,
} from "@/types";
import { seedFollows, seedUsers, seedVideos } from "./seed";
import { nanoid } from "@/lib/utils";

/**
 * In-memory data layer used when Supabase is not configured.
 * Swap call sites in `repository.ts` to the Supabase implementation
 * once credentials are present — this store is the development stand-in.
 */
class MemoryStore {
  users: User[] = structuredClone(seedUsers);
  videos: Video[] = structuredClone(seedVideos);
  jobs: GenerationJob[] = [];
  likes: Like[] = [];
  follows: Follow[] = seedFollows.map((f) => ({
    id: nanoid(),
    followerId: f.followerId,
    followingId: f.followingId,
    createdAt: new Date().toISOString(),
  }));
  dailyGenerations: { userId: string; date: string; count: number }[] = [];

  getUser(id: string) {
    return this.users.find((u) => u.id === id) ?? null;
  }

  getUserByUsername(username: string) {
    return (
      this.users.find(
        (u) => u.username.toLowerCase() === username.toLowerCase(),
      ) ?? null
    );
  }

  getUserByWallet(address: string) {
    return (
      this.users.find(
        (u) => u.walletAddress?.toLowerCase() === address.toLowerCase(),
      ) ?? null
    );
  }

  upsertUserFromWallet(address: string): User {
    const existing = this.getUserByWallet(address);
    if (existing) return existing;
    const short = address.slice(0, 4).toLowerCase();
    const username = `anon_${short}${address.slice(-2).toLowerCase()}`;
    const user: User = {
      id: `usr_${nanoid(8)}`,
      username,
      displayName: username,
      bio: "",
      avatarPalette: {
        from: "#0a0a0a",
        via: "#1a1608",
        to: "#3a3000",
        accent: "#FBE418",
      },
      walletAddress: address,
      followerCount: 0,
      followingCount: 0,
      profileComplete: false,
      avatarUrl: null,
      xHandle: null,
      createdAt: new Date().toISOString(),
    };
    this.users.push(user);
    return user;
  }

  withCreator(video: Video, viewerId?: string | null): VideoWithCreator {
    const creator = this.getUser(video.userId);
    if (!creator) {
      throw new Error(`Missing creator for video ${video.id}`);
    }
    return {
      ...video,
      creator: {
        id: creator.id,
        username: creator.username,
        displayName: creator.displayName,
        avatarPalette: creator.avatarPalette,
        avatarUrl: creator.avatarUrl ?? null,
        xHandle: creator.xHandle ?? null,
        walletAddress: creator.walletAddress,
      },
      likedByMe: viewerId
        ? this.likes.some((l) => l.videoId === video.id && l.userId === viewerId)
        : false,
    };
  }

  listDiscover(filter: DiscoverFilter, viewerId?: string | null): VideoWithCreator[] {
    let list = this.videos.filter(
      (v) => v.visibility === "public" && v.status === "complete",
    );

    if (filter === "following" && viewerId) {
      const followingIds = this.follows
        .filter((f) => f.followerId === viewerId)
        .map((f) => f.followingId);
      list = list.filter((v) => followingIds.includes(v.userId));
    } else if (filter === "following") {
      list = [];
    } else if (filter === "latest") {
      list = [...list].sort(
        (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
      );
    } else if (filter === "trending") {
      list = [...list].sort((a, b) => {
        const aHas = typeof a.sortOrder === "number";
        const bHas = typeof b.sortOrder === "number";
        if (aHas && bHas && a.sortOrder !== b.sortOrder) {
          return (a.sortOrder as number) - (b.sortOrder as number);
        }
        if (aHas !== bHas) return aHas ? -1 : 1;
        return b.likes + b.views / 8 - (a.likes + a.views / 8);
      });
    } else if (filter === "viral") {
      list = [...list].sort((a, b) => b.views - a.views || b.likes - a.likes);
    } else if (filter === "15s" || filter === "30s") {
      const seconds = filter === "15s" ? 15 : 30;
      list = list.filter((v) => v.duration === seconds);
    } else {
      list = list.filter((v) => v.category === filter);
    }

    if (filter === "trending" || filter === "latest") {
      // keep editorial spans
    } else {
      list = list.map((v) => ({ ...v, gridSpan: "normal" as const }));
    }

    return list.map((v) => this.withCreator(v, viewerId));
  }

  getVideo(id: string, viewerId?: string | null) {
    const video = this.videos.find((v) => v.id === id);
    if (!video) return null;
    return this.withCreator(video, viewerId);
  }

  listUserVideos(userId: string, tab: CreationsTab = "all"): Video[] {
    let list = this.videos.filter((v) => v.userId === userId);
    if (tab === "published") list = list.filter((v) => v.visibility === "public");
    if (tab === "private") list = list.filter((v) => v.visibility === "private");
    if (tab === "generating") {
      list = list.filter((v) =>
        ["queued", "preparing", "generating", "processing"].includes(v.status),
      );
    }
    return [...list].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }

  listPublicByUsername(username: string, viewerId?: string | null) {
    const user = this.getUserByUsername(username);
    if (!user) return { user: null, videos: [] as VideoWithCreator[] };
    const videos = this.videos
      .filter(
        (v) =>
          v.userId === user.id &&
          v.visibility === "public" &&
          v.status === "complete",
      )
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .map((v) => this.withCreator(v, viewerId));
    return { user, videos };
  }

  createVideo(video: Video) {
    this.videos.unshift(video);
    return video;
  }

  updateVideo(id: string, patch: Partial<Video>) {
    const idx = this.videos.findIndex((v) => v.id === id);
    if (idx === -1) return null;
    this.videos[idx] = { ...this.videos[idx], ...patch };
    return this.videos[idx];
  }

  reorderDiscover(ids: string[]) {
    ids.forEach((id, index) => {
      const video = this.videos.find((item) => item.id === id);
      if (video) video.sortOrder = index;
    });
  }

  deleteVideo(id: string, userId: string) {
    const video = this.videos.find((v) => v.id === id);
    if (!video || video.userId !== userId) return false;
    this.videos = this.videos.filter((v) => v.id !== id);
    this.likes = this.likes.filter((l) => l.videoId !== id);
    return true;
  }

  createJob(job: GenerationJob) {
    this.jobs.unshift(job);
    return job;
  }

  getJob(id: string) {
    return this.jobs.find((j) => j.id === id) ?? null;
  }

  getJobByVideoId(videoId: string) {
    return this.jobs.find((j) => j.videoId === videoId) ?? null;
  }

  listJobsForUser(userId: string) {
    return this.jobs.filter((j) => j.userId === userId);
  }

  updateJob(id: string, patch: Partial<GenerationJob>) {
    const idx = this.jobs.findIndex((j) => j.id === id);
    if (idx === -1) return null;
    this.jobs[idx] = { ...this.jobs[idx], ...patch, updatedAt: new Date().toISOString() };
    return this.jobs[idx];
  }

  toggleLike(userId: string, videoId: string) {
    const existing = this.likes.find(
      (l) => l.userId === userId && l.videoId === videoId,
    );
    const video = this.videos.find((v) => v.id === videoId);
    if (!video) return { liked: false, likes: 0 };
    if (existing) {
      this.likes = this.likes.filter((l) => l.id !== existing.id);
      video.likes = Math.max(0, video.likes - 1);
      return { liked: false, likes: video.likes };
    }
    this.likes.push({
      id: nanoid(),
      userId,
      videoId,
      createdAt: new Date().toISOString(),
    });
    video.likes += 1;
    return { liked: true, likes: video.likes };
  }

  recordView(videoId: string, userId: string | null) {
    const video = this.videos.find((v) => v.id === videoId);
    if (!video) return 0;
    video.views += 1;
    return video.views;
  }

  toggleFollow(followerId: string, username: string) {
    const target = this.getUserByUsername(username);
    if (!target) return null;
    if (target.id === followerId) return { following: false, followerCount: target.followerCount };
    const existing = this.follows.find(
      (f) => f.followerId === followerId && f.followingId === target.id,
    );
    if (existing) {
      this.follows = this.follows.filter((f) => f.id !== existing.id);
      target.followerCount = Math.max(0, target.followerCount - 1);
      const me = this.getUser(followerId);
      if (me) me.followingCount = Math.max(0, me.followingCount - 1);
      return { following: false, followerCount: target.followerCount };
    }
    this.follows.push({
      id: nanoid(),
      followerId,
      followingId: target.id,
      createdAt: new Date().toISOString(),
    });
    target.followerCount += 1;
    const me = this.getUser(followerId);
    if (me) me.followingCount += 1;
    return { following: true, followerCount: target.followerCount };
  }

  isFollowing(followerId: string, userId: string) {
    return this.follows.some(
      (f) => f.followerId === followerId && f.followingId === userId,
    );
  }

  incrementDaily(userId: string) {
    const date = new Date().toISOString().slice(0, 10);
    const row = this.dailyGenerations.find(
      (d) => d.userId === userId && d.date === date,
    );
    if (row) {
      row.count += 1;
      return row.count;
    }
    this.dailyGenerations.push({ userId, date, count: 1 });
    return 1;
  }

  getDailyCount(userId: string) {
    const date = new Date().toISOString().slice(0, 10);
    return (
      this.dailyGenerations.find((d) => d.userId === userId && d.date === date)
        ?.count ?? 0
    );
  }

  userStats(userId: string) {
    const vids = this.videos.filter(
      (v) => v.userId === userId && v.status === "complete",
    );
    const published = vids.filter((v) => v.visibility === "public");
    return {
      totalCreations: vids.length,
      publishedCount: published.length,
      totalViews: published.reduce((sum, v) => sum + v.views, 0),
    };
  }

  completeProfile(
    userId: string,
    patch: {
      username: string;
      displayName: string;
      xHandle: string | null;
      avatarUrl?: string | null;
    },
  ) {
    const taken = this.getUserByUsername(patch.username);
    if (taken && taken.id !== userId) {
      const error = new Error("USERNAME_TAKEN");
      error.name = "USERNAME_TAKEN";
      throw error;
    }
    const user = this.getUser(userId);
    if (!user) return null;
    user.username = patch.username;
    user.displayName = patch.displayName;
    user.xHandle = patch.xHandle;
    user.profileComplete = true;
    if (patch.avatarUrl !== undefined) user.avatarUrl = patch.avatarUrl;
    return user;
  }
}

const globalStore = globalThis as unknown as { __gener8Store?: MemoryStore };
export const store = globalStore.__gener8Store ?? new MemoryStore();
if (!globalStore.__gener8Store) globalStore.__gener8Store = store;
