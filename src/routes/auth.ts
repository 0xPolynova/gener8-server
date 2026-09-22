import { Router } from "express";
import { issueNonce, authMessage, consumeNonce, assertLoginMessage } from "@/lib/auth/nonce";
import {
  buildSession,
  clearSessionCookie,
  getSession,
  setSessionCookie,
  signSession,
} from "@/lib/auth/session";
import { db } from "@/lib/data/repository";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { isProfileComplete } from "@/lib/profile";
import { verifyWalletSignature } from "@/lib/solana/verify";
import { asyncHandler } from "@/middleware/async";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const authRouter = Router();

authRouter.post(
  "/connect",
  asyncHandler(async (req, res) => {
    const wallet = String(req.body?.wallet ?? "").trim();
    if (!SOLANA_ADDRESS_RE.test(wallet)) {
      throw new AppError(ERROR_CODES.WALLET_DISCONNECTED, 400);
    }

    const user = await db.getUserByWallet(wallet);
    const complete = isProfileComplete(user);
    if (!user || !complete) {
      res.json({
        session: null,
        user: complete ? user : null,
        token: null,
        needsOnboarding: true,
      });
      return;
    }

    const session = buildSession({
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      walletAddress: user.walletAddress ?? wallet,
    });
    const token = await signSession(session);
    setSessionCookie(res, token);
    console.info("[auth] connect existing", wallet.slice(0, 6), user.id);
    res.json({
      session,
      user,
      token,
      needsOnboarding: false,
    });
  }),
);

authRouter.post(
  "/nonce",
  asyncHandler(async (req, res) => {
    const wallet = String(req.body?.wallet ?? "").trim();
    if (!wallet) throw new AppError(ERROR_CODES.WALLET_DISCONNECTED, 400);
    const nonce = issueNonce(wallet);
    console.info("[auth] nonce", wallet.slice(0, 6));
    res.json({ nonce, message: authMessage(wallet, nonce) });
  }),
);

authRouter.post(
  "/verify",
  asyncHandler(async (req, res) => {
    const wallet = String(req.body?.wallet ?? "").trim();
    const nonce = String(req.body?.nonce ?? "").trim();
    const signature = String(req.body?.signature ?? "").trim();
    const rawMessage = String(req.body?.message ?? "").trim();

    const message =
      rawMessage || (wallet && nonce ? authMessage(wallet, nonce) : "");

    if (!wallet || !signature || !message) {
      throw new AppError(ERROR_CODES.INVALID_SIGNATURE, 400);
    }

    if (rawMessage) {
      if (!assertLoginMessage(rawMessage, wallet)) {
        throw new AppError(
          ERROR_CODES.INVALID_SIGNATURE,
          401,
          "Sign-in expired. Try again.",
        );
      }
    } else if (!consumeNonce(wallet, nonce)) {
      throw new AppError(
        ERROR_CODES.INVALID_SIGNATURE,
        401,
        "Sign-in expired. Try again.",
      );
    }

    if (!verifyWalletSignature({ wallet, message, signature })) {
      console.warn("[auth] signature mismatch", {
        wallet,
        signatureLength: signature.length,
      });
      throw new AppError(ERROR_CODES.INVALID_SIGNATURE, 401);
    }

    const user = await db.upsertUserFromWallet(wallet);
    console.info("[auth] verified", wallet.slice(0, 6), user.id);
    const session = buildSession({
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      walletAddress: wallet,
    });
    const token = await signSession(session);
    setSessionCookie(res, token);
    res.json({
      session,
      user,
      token,
      needsOnboarding: !isProfileComplete(user),
    });
  }),
);

authRouter.get(
  "/session",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    if (!session) {
      res.json({ session: null, user: null });
      return;
    }
    const user = await db.getUser(session.userId);
    res.json({
      session,
      user,
      needsOnboarding: Boolean(user && !isProfileComplete(user)),
    });
  }),
);

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
