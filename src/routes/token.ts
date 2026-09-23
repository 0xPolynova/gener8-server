import { Router } from "express";
import { getSession } from "@/lib/auth/session";
import { env } from "@/lib/config/env";
import { minimumAccessBalance } from "@/lib/config/gating";
import { evaluateEligibility } from "@/lib/gating/evaluate";
import { asyncHandler } from "@/middleware/async";
import type { Eligibility } from "@/types";

export const tokenRouter = Router();

function unavailable(session: boolean): Eligibility {
  return {
    state: session ? "unauthenticated" : "disconnected",
    balance: null,
    required: minimumAccessBalance(),
    remainingToday: null,
    dailyLimit: null,
    tier: null,
  };
}

tokenRouter.get(
  "/balance",
  asyncHandler(async (req, res) => {
    const session = await getSession(req);
    let eligibility: Eligibility;
    try {
      eligibility = await evaluateEligibility({
        session,
        walletConnected: Boolean(session),
        walletAddress: session?.walletAddress,
      });
    } catch {
      eligibility = unavailable(Boolean(session));
    }
    res.json({ eligibility, session, mint: env.tokenMint || null });
  }),
);
