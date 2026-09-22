import type { VideoModel } from "@/types";

export const PRESET_MODEL_ID = "seedance";

export const OPENROUTER_MODELS = {
  fast: "bytedance/seedance-2.0-fast",
  pro: "bytedance/seedance-2.0",
  cinematic: "alibaba/wan-3.0",
} as const;

export const DEFAULT_CUSTOM_MODEL = OPENROUTER_MODELS.fast;

const LEGACY_MODEL_IDS: Record<string, string> = {
  "gener8-fast": OPENROUTER_MODELS.fast,
  "gener8-pro": OPENROUTER_MODELS.pro,
  "gener8-cinematic": OPENROUTER_MODELS.cinematic,
};

export const VIDEO_MODELS: VideoModel[] = [
  {
    id: "bytedance/seedance-2.0-fast",
    name: "Seedance 2.0 Fast",
    description: "ByteDance draft model. Fast and cheap.",
    minTier: 1,
    estimatedSeconds: 120,
  },
  {
    id: "bytedance/seedance-1-5-pro",
    name: "Seedance 1.5 Pro",
    description: "Older Seedance. Low cost, solid clips.",
    minTier: 1,
    estimatedSeconds: 140,
  },
  {
    id: "google/veo-3.1-lite",
    name: "Veo 3.1 Lite",
    description: "Google’s cheapest Veo. Short clips with audio.",
    minTier: 1,
    estimatedSeconds: 150,
  },
  {
    id: "minimax/hailuo-2.3",
    name: "Hailuo 2.3",
    description: "MiniMax text-to-video. Good everyday drafts.",
    minTier: 1,
    estimatedSeconds: 140,
  },
  {
    id: "alibaba/wan-2.6",
    name: "Wan 2.6",
    description: "Alibaba Wan. Affordable cinematic look.",
    minTier: 1,
    estimatedSeconds: 160,
  },
  {
    id: "bytedance/seedance-2.0",
    name: "Seedance 2.0",
    description: "Stronger motion and consistency than Fast.",
    minTier: 2,
    estimatedSeconds: 150,
  },
  {
    id: "kwaivgi/kling-v3.0-std",
    name: "Kling 3.0 Standard",
    description: "Kuaishou Kling. Solid cinematic T2V.",
    minTier: 2,
    estimatedSeconds: 180,
  },
  {
    id: "alibaba/wan-2.7",
    name: "Wan 2.7",
    description: "Newer Wan than 2.6. Sharper motion.",
    minTier: 2,
    estimatedSeconds: 170,
  },
  {
    id: "google/veo-3.1-fast",
    name: "Veo 3.1 Fast",
    description: "Google Veo, faster/cheaper than full 3.1.",
    minTier: 2,
    estimatedSeconds: 160,
  },
  {
    id: "alibaba/wan-3.0",
    name: "Wan 3.0",
    description: "Latest Wan. Up to 30s cinematic T2V.",
    minTier: 3,
    estimatedSeconds: 190,
  },
  {
    id: "bytedance/seedance-2.5",
    name: "Seedance 2.5",
    description: "Newest Seedance. Best ByteDance quality.",
    minTier: 3,
    estimatedSeconds: 200,
  },
  {
    id: "kwaivgi/kling-v3.0-pro",
    name: "Kling 3.0 Pro",
    description: "Highest-quality Kling text-to-video.",
    minTier: 3,
    estimatedSeconds: 210,
  },
  {
    id: "kwaivgi/kling-video-o1",
    name: "Kling Video O1",
    description: "Kling Omni. Strong edit and reference work.",
    minTier: 3,
    estimatedSeconds: 200,
  },
  {
    id: "google/veo-3.1",
    name: "Veo 3.1",
    description: "Full Google Veo. Photoreal with native audio.",
    minTier: 3,
    estimatedSeconds: 220,
  },
  {
    id: "openai/sora-2-pro",
    name: "Sora 2 Pro",
    description: "OpenAI Sora. Top-end, expensive.",
    minTier: 3,
    estimatedSeconds: 240,
  },
  {
    id: PRESET_MODEL_ID,
    name: "Wan 3.0",
    description: "Hotel Lobby character swap on WaveSpeed Wan 3.0.",
    minTier: 1,
    estimatedSeconds: 120,
  },
];

export function modelsAllowedForTier(tierId: number) {
  return VIDEO_MODELS.filter((model) => model.minTier <= tierId).map((model) => model.id);
}

export function resolveVideoModelId(id: string | undefined) {
  const requested = id ? (LEGACY_MODEL_IDS[id] ?? id) : DEFAULT_CUSTOM_MODEL;
  return VIDEO_MODELS.find((model) => model.id === requested) ?? VIDEO_MODELS[0];
}

export const ASPECT_RATIOS = [
  { id: "16:9" as const, label: "16:9", hint: "Landscape" },
  { id: "9:16" as const, label: "9:16", hint: "Vertical" },
  { id: "1:1" as const, label: "1:1", hint: "Square" },
];

export const DURATIONS = [
  { id: 5 as const, label: "5s" },
  { id: 10 as const, label: "10s" },
  { id: 15 as const, label: "15s" },
];

export const QUALITIES = [
  { id: "standard" as const, label: "Standard" },
  { id: "high" as const, label: "High" },
];

export const CAMERA_MOVEMENTS = [
  { id: "static" as const, label: "Static" },
  { id: "pan" as const, label: "Pan" },
  { id: "tilt" as const, label: "Tilt" },
  { id: "dolly" as const, label: "Dolly" },
  { id: "orbit" as const, label: "Orbit" },
  { id: "handheld" as const, label: "Handheld" },
  { id: "crane" as const, label: "Crane" },
] as const;

export const PROMPT_INSPIRATIONS = [
  {
    label: "Cinematic drone shot",
    prompt:
      "Cinematic drone shot gliding over a rain-soaked neon city at 3am, steam rising from street vents, anamorphic bokeh, slow descent between glass towers, moody teal and tungsten light.",
  },
  {
    label: "Product commercial",
    prompt:
      "Macro product commercial of a matte-black timepiece rotating on obsidian, razor rim light, floating dust motes, ultra-clean studio, 8k texture, slow orbit.",
  },
  {
    label: "Anime sequence",
    prompt:
      "Anime sequence: a lone rider cutting through a cherry-blossom storm at dusk, dramatic speed lines, rich cel shading, wind tearing at a long coat, cinematic widescreen.",
  },
  {
    label: "Surreal landscape",
    prompt:
      "Surreal landscape of floating limestone islands above a golden sea of clouds, impossible architecture, late-afternoon god rays, IMAX scale, quiet and vast.",
  },
];

export const MAX_PROMPT_LENGTH = 20000;
export const MIN_PROMPT_LENGTH = 8;
export const MAX_TITLE_LENGTH = 80;

export const SAMPLE_VIDEO_URLS = [
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
];
