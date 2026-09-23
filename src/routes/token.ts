import { Router } from "express";
import { getSession } from "@/lib/auth/session";
import { env } from "@/lib/config/env";
import { evaluateEligibility } from "@/lib/gating/evaluate";
import { asyncHandler } from "@/middleware/async";

export const tokenRouter = Router();

tokenRouter.get(
  "/balance",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    const eligibility = await evaluateEligibility({
      session,
      walletConnected: Boolean(session),
      walletAddress: session?.walletAddress,
    });
    res.json({ eligibility, session, mint: env.tokenMint || null });
  }),
);
