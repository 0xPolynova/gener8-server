type LogLevel = "info" | "warn" | "error";

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

export function log(
  level: LogLevel,
  msg: string,
  extra: Record<string, unknown> = {},
) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...extra,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
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
