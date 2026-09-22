export type AspectRatio = "16:9" | "9:16" | "1:1";
export type VideoQuality = "standard" | "high";
export type VideoDuration = 5 | 10 | 15;
export type Visibility = "public" | "private";

export type GenerationStatus =
  | "queued"
  | "preparing"
  | "generating"
  | "processing"
  | "complete"
  | "failed";

export type VideoCategory =
  | "cinematic"
  | "animation"
  | "memes"
  | "music"
  | "experimental"
  | "product";

export type GridSpan = "normal" | "wide" | "tall" | "hero";

export type CameraMovement =
  | "static"
  | "pan"
  | "tilt"
  | "dolly"
  | "orbit"
  | "handheld"
  | "crane";

export interface PosterPalette {
  from: string;
  via: string;
  to: string;
  accent: string;
  grain?: number;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarPalette: PosterPalette;
  avatarUrl?: string | null;
  xHandle?: string | null;
  profileComplete?: boolean;
  walletAddress: string | null;
  followerCount: number;
  followingCount: number;
  createdAt: string;
}

export interface WalletRecord {
  id: string;
  userId: string;
  address: string;
  chain: "solana";
  createdAt: string;
}

export interface Video {
  id: string;
  userId: string;
  prompt: string;
  publicPrompt: boolean;
  title: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  poster: PosterPalette;
  model: string;
  aspectRatio: AspectRatio;
  duration: VideoDuration;
  quality: VideoQuality;
  status: GenerationStatus;
  visibility: Visibility;
  createdAt: string;
  publishedAt: string | null;
  provider: string;
  providerJobId: string | null;
  views: number;
  likes: number;
  category: VideoCategory;
  featured?: boolean;
  gridSpan?: GridSpan;
  sortOrder?: number | null;
  seed?: number | null;
  negativePrompt?: string;
  cameraMovement?: CameraMovement;
  promptAdherence?: number;
  creativity?: number;
  errorMessage?: string | null;
}

export interface GenerationJob {
  id: string;
  userId: string;
  videoId: string;
  status: GenerationStatus;
  progress: number;
  prompt: string;
  settings: GenerationSettings;
  provider: string;
  providerJobId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface GenerationSettings {
  model: string;
  aspectRatio: AspectRatio;
  duration: VideoDuration;
  quality: VideoQuality;
  negativePrompt: string;
  seed: number | null;
  cameraMovement: CameraMovement;
  promptAdherence: number;
  creativity: number;
  publicPrompt: boolean;
}

export interface Like {
  id: string;
  userId: string;
  videoId: string;
  createdAt: string;
}

export interface Follow {
  id: string;
  followerId: string;
  followingId: string;
  createdAt: string;
}

export interface ViewRecord {
  id: string;
  videoId: string;
  userId: string | null;
  createdAt: string;
}

export interface Session {
  userId: string;
  username: string;
  displayName: string;
  walletAddress: string;
  createdAt: string;
  expiresAt: string;
}

export interface TokenTier {
  id: number;
  name: string;
  minimumBalance: number;
  dailyGenerations: number;
  models: string[];
  label: string;
}

export type GatingState =
  | "disconnected"
  | "unauthenticated"
  | "insufficient"
  | "eligible"
  | "limit_reached";

export interface Eligibility {
  state: GatingState;
  balance: number | null;
  required: number;
  remainingToday: number | null;
  dailyLimit: number | null;
  tier: TokenTier | null;
}

export interface VideoModel {
  id: string;
  name: string;
  description: string;
  minTier: number;
  estimatedSeconds: number;
}

export type DiscoverFilter =
  | "trending"
  | "latest"
  | "following"
  | "cinematic"
  | "animation"
  | "memes"
  | "music"
  | "experimental";

export type CreationsTab = "all" | "published" | "private" | "generating";

export interface ApiErrorBody {
  error: string;
  code: string;
}

export interface VideoWithCreator extends Video {
  creator: Pick<
    User,
    | "id"
    | "username"
    | "displayName"
    | "avatarPalette"
    | "avatarUrl"
    | "xHandle"
    | "walletAddress"
  >;
  likedByMe?: boolean;
}
