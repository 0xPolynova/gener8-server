import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envFiles = [
  path.resolve(process.cwd(), "../.env"),
  path.resolve(process.cwd(), "../.env.local"),
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), ".env.local"),
];
for (const file of envFiles) {
  if (!fs.existsSync(file)) continue;
  const parsed = dotenv.parse(fs.readFileSync(file));
  for (const [key, value] of Object.entries(parsed)) {
    if (value === "") continue;
    process.env[key] = value;
  }
}

function read(name: string, fallback = "") {
  return process.env[name] ?? fallback;
}

function readNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function readBool(name: string, fallback = false) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw === "true" || raw === "1";
}

function readList(name: string, fallback: string[]) {
  const raw = read(name);
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveVideoProvider() {
  const named = read("VIDEO_PROVIDER", "");
  const wan = read("WAN_API_KEY");
  const wavespeed = read("WAVESPEED_API_KEY");
  const fal = read("FAL_KEY");
  const atlas = read("ATLASCLOUD_API_KEY") || read("ATLAS_API_KEY");
  const openrouter = read("OPENROUTER_API_KEY") || read("VIDEO_PROVIDER_API_KEY");
  if (named && named !== "mock") return named;
  if (wan) return "wan";
  if (wavespeed) return "wavespeed";
  if (fal) return "fal";
  if (atlas) return "atlascloud";
  if (openrouter) return "openrouter";
  return "mock";
}

export const env = {
  nodeEnv: read("NODE_ENV", "development"),
  port: readNumber("PORT", 4000),
  appUrl: read("APP_URL", "http://localhost:3000"),
  corsOrigins: readList("CORS_ORIGINS", [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]),
  sessionSecret: read("SESSION_SECRET", "gener8-dev-session-secret-change-me"),

  supabaseUrl:
    read("SUPABASE_URL") ||
    read("SUPABASE_PROJECT_URL") ||
    read("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseServiceRoleKey: read("SUPABASE_SERVICE_ROLE_KEY"),

  solanaRpc: read("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com"),
  tokenMint: read("GENER8_TOKEN_MINT"),
  tokenDecimals: readNumber("GENER8_TOKEN_DECIMALS", 9),
  tokenSymbol: read("GENER8_TOKEN_SYMBOL", "GENER8"),
  getTokenUrl: read("GET_GENER8_URL"),

  minBalance: readNumber("GENER8_MIN_BALANCE", 10_000),
  dailyGenerations: readNumber("GENER8_DAILY_GENERATIONS", 5),

  videoProvider: resolveVideoProvider(),
  videoProviderApiKey: read("VIDEO_PROVIDER_API_KEY"),
  videoProviderBaseUrl: read(
    "VIDEO_PROVIDER_BASE_URL",
    "https://api.atlascloud.ai",
  ),
  videoProviderWebhookSecret: read("VIDEO_PROVIDER_WEBHOOK_SECRET"),
  falKey: read("FAL_KEY"),
  falModelT2v: read(
    "FAL_MODEL_T2V",
    "bytedance/seedance-2.5/text-to-video",
  ),
  falModelRef: read(
    "FAL_MODEL_REF",
    "fal-ai/kling-video/o1/video-to-video/edit",
  ),
  wavespeedApiKey: read("WAVESPEED_API_KEY"),
  wavespeedBaseUrl: read(
    "WAVESPEED_BASE_URL",
    "https://api.wavespeed.ai/api/v3",
  ),
  wavespeedModelRef: read(
    "WAVESPEED_MODEL_REF",
    "alibaba/wan-3.0/reference-to-video",
  ),
  wavespeedModelSeedance: read(
    "WAVESPEED_MODEL_SEEDANCE",
    "bytedance/seedance-2.0/text-to-video",
  ),
  atlascloudApiKey: read("ATLASCLOUD_API_KEY") || read("ATLAS_API_KEY"),
  atlasModelFast: read(
    "ATLAS_MODEL_FAST",
    "alibaba/wan-3.0/text-to-video",
  ),
  atlasModelPro: read(
    "ATLAS_MODEL_PRO",
    "alibaba/wan-3.0/text-to-video",
  ),
  atlasModelCinematic: read(
    "ATLAS_MODEL_CINEMATIC",
    "alibaba/wan-3.0/text-to-video",
  ),
  atlasModelSeedance: read(
    "ATLAS_MODEL_SEEDANCE",
    "alibaba/wan-3.0/text-to-video",
  ),
  atlasModelRef: read("ATLAS_MODEL_REF") ||
    read("ATLAS_MODEL_SEEDANCE_REF", "alibaba/wan-3.0/reference-to-video"),
  openrouterApiKey: read("OPENROUTER_API_KEY") || read("VIDEO_PROVIDER_API_KEY"),
  openrouterImageModel: read(
    "OPENROUTER_IMAGE_MODEL",
    "google/gemini-3.1-flash-lite-image",
  ),
  cfAccountId: read("CF_ACCOUNT_ID"),
  cfImagesApiToken: read("CF_IMAGES_API_TOKEN"),
  cfImagesAccountHash: read("CF_IMAGES_ACCOUNT_HASH", "evSvvg4gSrZmei5DvWV8Aw"),
  openrouterBaseUrl: read(
    "OPENROUTER_BASE_URL",
    "https://openrouter.ai/api/v1",
  ),
  openrouterModelFast: read("OPENROUTER_MODEL_FAST", "bytedance/seedance-2.0-fast"),
  openrouterModelPro: read("OPENROUTER_MODEL_PRO", "bytedance/seedance-2.0"),
  openrouterModelCinematic: read(
    "OPENROUTER_MODEL_CINEMATIC",
    "alibaba/wan-3.0",
  ),
  openrouterModelSeedance: read(
    "OPENROUTER_MODEL_SEEDANCE",
    "bytedance/seedance-2.0",
  ),

  demoMode: readBool("DEMO_MODE", true),
  demoTokenBalance: readNumber("DEMO_TOKEN_BALANCE", 25000),

  wanApiKey: read("WAN_API_KEY"),
  wanRegion: read("WAN_REGION", "ap-southeast-1"),
};

export const isProd = env.nodeEnv === "production";


export function isSupabaseConfigured() {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
}

export function isOnChainConfigured() {
  return Boolean(env.tokenMint) && !env.demoMode;
}

