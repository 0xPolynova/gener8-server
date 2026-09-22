import type { Request, Response } from "express";
import { env, isProd } from "@/lib/config/env";
import type { Session } from "@/types";

export const SESSION_COOKIE = "gener8_session";
const TTL_MS = 1000 * 60 * 60 * 24 * 14;

async function hmac(message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return bufferToHex(sig);
}

function bufferToHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function encodePayload(session: Session) {
  return Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}

function decodePayload(payload: string): Session | null {
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function signSession(session: Session) {
  const payload = encodePayload(session);
  const signature = await hmac(payload);
  return `${payload}.${signature}`;
}

export async function verifySessionToken(token: string): Promise<Session | null> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = await hmac(payload);
  if (expected.length !== signature.length) return null;
  const a = new Uint8Array(Buffer.from(expected, "hex"));
  const b = new Uint8Array(Buffer.from(signature, "hex"));
  if (a.length !== b.length) return null;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return null;
  const session = decodePayload(payload);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;
  return session;
}

export function buildSession(params: {
  userId: string;
  username: string;
  displayName: string;
  walletAddress: string;
}): Session {
  const now = Date.now();
  return {
    ...params,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
  };
}

function cookieOptions() {
  return {
    httpOnly: true,
    path: "/",
    maxAge: TTL_MS,
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    secure: isProd,
  };
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, cookieOptions());
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export function readSessionToken(req: Request) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  const cookie = req.cookies?.[SESSION_COOKIE];
  return typeof cookie === "string" ? cookie : null;
}

export async function getSession(req: Request): Promise<Session | null> {
  const token = readSessionToken(req);
  if (!token) return null;
  return verifySessionToken(token);
}
