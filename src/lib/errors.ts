import type { Response } from "express";

export const ERROR_CODES = {
  WALLET_DISCONNECTED: "WALLET_DISCONNECTED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  GENERATION_LIMIT: "GENERATION_LIMIT",
  RPC_FAILURE: "RPC_FAILURE",
  PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
  GENERATION_FAILED: "GENERATION_FAILED",
  UPLOAD_FAILED: "UPLOAD_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  INVALID_PROMPT: "INVALID_PROMPT",
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  USERNAME_TAKEN: "USERNAME_TAKEN",
  USERNAME_INVALID: "USERNAME_INVALID",
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const MESSAGES: Record<ErrorCode, string> = {
  WALLET_DISCONNECTED: "Connect a Solana wallet to continue.",
  UNAUTHENTICATED: "Connect your wallet to continue.",
  SESSION_EXPIRED: "Your session expired. Please connect again.",
  INSUFFICIENT_BALANCE: "You need more GENER8 to unlock generation.",
  GENERATION_LIMIT: "You’ve reached today’s generation limit. Come back tomorrow.",
  RPC_FAILURE: "We couldn’t reach the Solana network. Try again in a moment.",
  PROVIDER_TIMEOUT: "Generation took too long. Please try again.",
  GENERATION_FAILED: "Generation failed. Your prompt was saved — try regenerating.",
  UPLOAD_FAILED: "We couldn’t save your video. Please try again.",
  RATE_LIMITED: "Slow down — too many requests. Wait a few seconds.",
  INVALID_PROMPT: "Write a slightly longer prompt so we know what to generate.",
  INVALID_SIGNATURE: "Wallet signature didn’t match. Please try signing again.",
  USERNAME_TAKEN: "That username is taken. Try another.",
  USERNAME_INVALID: "Usernames are 3–20 characters: letters, numbers, underscores.",
  NOT_FOUND: "That creation couldn’t be found.",
  FORBIDDEN: "You don’t have access to this action.",
  INTERNAL: "Something went wrong. Please try again.",
};

export class AppError extends Error {
  code: ErrorCode;
  status: number;

  constructor(code: ErrorCode, status = 400, message?: string) {
    super(message ?? MESSAGES[code]);
    this.code = code;
    this.status = status;
    this.name = "AppError";
  }
}

export function sendError(res: Response, error: unknown, fallbackStatus = 500) {
  if (error instanceof AppError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  return res.status(fallbackStatus).json({
    error: MESSAGES.INTERNAL,
    code: ERROR_CODES.INTERNAL,
  });
}
