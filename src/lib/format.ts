export function titleFromPrompt(prompt: string): string {
  const clean = prompt.replace(/\s+/g, " ").trim();
  const first = clean.split(/[.!?]/)[0] ?? clean;
  if (first.length <= 48) return first;
  return `${first.slice(0, 48).trim()}…`;
}

export function sanitizeTitle(raw: unknown, fallback = "") {
  if (typeof raw !== "string") return fallback;
  const title = raw.replace(/\s+/g, " ").trim().slice(0, 80);
  return title || fallback;
}
