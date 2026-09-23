type LogLevel = "info" | "warn" | "error";

const compact = process.env.NODE_ENV === "production";

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    const extra = error as Error & { code?: string; status?: number };
    return {
      name: extra.name,
      message: extra.message,
      code: extra.code,
      status: extra.status,
      stack: extra.stack,
    };
  }
  return { message: String(error) };
}

function clock() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function printValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value == null || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function shortStack(stack: string | undefined) {
  if (!stack) return [];
  return stack
    .split("\n")
    .slice(1)
    .map((line) => line.trim().replace(/^at /, ""))
    .filter((line) => /gener8-main[\\/]+src[\\/]/.test(line))
    .slice(0, 4)
    .map((line) => line.replace(/^.*gener8-main[\\/]+src[\\/]/, "src/").replace(/\\/g, "/"));
}

function write(level: LogLevel, text: string) {
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export function log(level: LogLevel, msg: string, extra: Record<string, unknown> = {}) {
  if (compact) {
    write(level, JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
    return;
  }

  const lines = ["", `${clock()}  ${level.toUpperCase().padEnd(5)}  ${msg}`];
  const err = extra.err as { message?: string; code?: string; status?: number; stack?: string } | undefined;
  for (const [key, value] of Object.entries(extra)) {
    if (key === "err" || value == null) continue;
    lines.push(`  ${key}: ${printValue(value)}`);
  }
  if (err?.message) lines.push(`  ${err.message}`);
  if (err?.code) lines.push(`  code: ${err.code}${err.status ? `  ${err.status}` : ""}`);
  for (const frame of shortStack(err?.stack)) lines.push(`    at ${frame}`);
  write(level, lines.join("\n"));
}

export const logger = {
  info(msg: string, extra?: Record<string, unknown>) {
    log("info", msg, extra);
  },
  warn(msg: string, extra?: Record<string, unknown>) {
    log("warn", msg, extra);
  },
  error(msg: string, extra?: Record<string, unknown>) {
    log("error", msg, extra);
  },
};
