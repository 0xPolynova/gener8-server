import type { Eligibility, GatingState, Session } from "@/types";
import {
  fullAccessTier,
  isFullAccessUsername,
  minimumAccessBalance,
  tierForBalance,
  TOKEN_GATING,
} from "@/lib/config/gating";
import { db } from "@/lib/data/repository";
import { getGener8Balance } from "@/lib/solana/token";

export async function evaluateEligibility(params: {
  session: Session | null;
  walletConnected: boolean;
  walletAddress?: string | null;
}): Promise<Eligibility> {
  const required = minimumAccessBalance();

  if (!params.walletConnected && !params.session) {
    return empty("disconnected", required);
  }

  if (!params.session) {
    return empty("unauthenticated", required);
  }

  const account = await db.getUser(params.session.userId);
  const username = account?.username ?? params.session.username;
  if (isFullAccessUsername(username)) {
    const balance = await getGener8Balance(params.session.walletAddress);
    const tier = fullAccessTier();
    const used = await db.getDailyCount(params.session.userId);
    return {
      state: "eligible",
      balance,
      required,
      remainingToday: Math.max(0, tier.dailyGenerations - used),
      dailyLimit: tier.dailyGenerations,
      tier,
    };
  }

  const balance = await getGener8Balance(params.session.walletAddress);
  const tier = tierForBalance(balance);

  if (!tier) {
    return {
      state: "insufficient",
      balance,
      required,
      remainingToday: 0,
      dailyLimit: TOKEN_GATING.tiers[0].dailyGenerations,
      tier: null,
    };
  }

  const used = await db.getDailyCount(params.session.userId);
  const remaining = Math.max(0, tier.dailyGenerations - used);
  const state: GatingState = remaining <= 0 ? "limit_reached" : "eligible";

  return {
    state,
    balance,
    required,
    remainingToday: remaining,
    dailyLimit: tier.dailyGenerations,
    tier,
  };
}

function empty(state: GatingState, required: number): Eligibility {
  return {
    state,
    balance: null,
    required,
    remainingToday: null,
    dailyLimit: TOKEN_GATING.tiers[0].dailyGenerations,
    tier: null,
  };
}
