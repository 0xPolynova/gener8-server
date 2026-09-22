import path from "node:path";
import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { env, isProd, isSupabaseConfigured } from "@/lib/config/env";
import { AppError, sendError } from "@/lib/errors";
import { logger, serializeError } from "@/lib/log";
import { authRouter } from "@/routes/auth";
import { generateRouter } from "@/routes/generate";
import { meRouter } from "@/routes/me";
import { refsRouter } from "@/routes/refs";
import { tokenRouter } from "@/routes/token";
import { usersRouter } from "@/routes/users";
import { videosRouter } from "@/routes/videos";

const app = express();

app.set("trust proxy", 1);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (env.corsOrigins.includes(origin) || origin === env.appUrl) {
        return callback(null, true);
      }
      try {
        const host = new URL(origin).hostname;
        if (host === "localhost" || host === "127.0.0.1") {
          return callback(null, true);
        }
      } catch {
        /* ignore */
      }
      return callback(null, false);
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "32mb" }));
app.use(cookieParser());
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "gener8server",
    supabase: isSupabaseConfigured(),
    videoProvider: env.videoProvider,
    fal: Boolean(env.falKey),
    wavespeed: Boolean(env.wavespeedApiKey),
    openrouter: Boolean(env.openrouterApiKey),
    env: env.nodeEnv,
  });
});

app.use("/api/auth", authRouter);
app.use("/api/token", tokenRouter);
app.use("/api/generate", generateRouter);
app.use("/api/refs", refsRouter);
app.use("/api/videos", videosRouter);
app.use("/api/users", usersRouter);
app.use("/api/me", meRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});

app.use(
  (
    error: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const status = error instanceof AppError ? error.status : 500;
    const code = error instanceof AppError ? error.code : "INTERNAL";
    const payload = {
      method: req.method,
      path: req.originalUrl,
      status,
      code,
      err: serializeError(error),
    };
    if (status >= 500 || code === "GENERATION_FAILED" || code === "PROVIDER_TIMEOUT") {
      logger.error("request failed", payload);
    } else if (status !== 401 && status !== 404) {
      logger.warn("request rejected", payload);
    }
    sendError(res, error);
  },
);

process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection", { err: serializeError(reason) });
});

process.on("uncaughtException", (error) => {
  logger.error("uncaughtException", { err: serializeError(error) });
});

app.listen(env.port, () => {
  logger.info("listening", {
    env: isProd ? "prod" : "dev",
    port: env.port,
    supabase: isSupabaseConfigured(),
    video: env.videoProvider,
    wavespeed: Boolean(env.wavespeedApiKey),
    openrouter: Boolean(env.openrouterApiKey),
  });
});

