export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const X_HANDLE_PATTERN = /^[a-zA-Z0-9_]{1,15}$/;
const RESERVED = new Set([
  "admin",
  "api",
  "create",
  "creations",
  "discover",
  "gener8",
  "login",
  "me",
  "profile",
  "settings",
  "video",
  "videos",
  "wallet",
]);

export function normalizeUsername(raw: string) {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

export function assertUsername(raw: string) {
  const username = normalizeUsername(raw);
  if (!USERNAME_PATTERN.test(username) || RESERVED.has(username)) {
    return { ok: false as const, username };
  }
  return { ok: true as const, username };
}

export function normalizeXHandle(raw: string) {
  return raw
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "")
    .split(/[/?#]/)[0]
    .trim();
}

export function assertXHandle(raw: string) {
  const handle = normalizeXHandle(raw);
  if (!handle) return { ok: true as const, handle: null };
  if (!X_HANDLE_PATTERN.test(handle)) {
    return { ok: false as const, handle };
  }
  return { ok: true as const, handle };
}

export function isProfileComplete(user: {
  profileComplete?: boolean;
  username?: string;
} | null | undefined) {
  if (!user) return false;
  if (user.profileComplete) return true;
  const username = user.username?.trim() ?? "";
  return username.length >= 3 && !/^anon_/i.test(username);
}
