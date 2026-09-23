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
    return {
      state: "eligible",
      balance,
      required,
      remainingToday: null,
      dailyLimit: null,
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
      dailyLimit: TOKEN_GATING.tiers[0].hourlyGenerations,
      tier: null,
    };
  }

  const started = await generationsThisHour(params.session.userId);
  const cap = tier.hourlyGenerations;
  const remaining = cap == null ? null : Math.max(0, cap - started);
  const state: GatingState = remaining === 0 ? "limit_reached" : "eligible";

  return {
    state,
    balance,
    required,
    remainingToday: remaining,
    dailyLimit: cap,
    tier,
  };
}

async function generationsThisHour(userId: string) {
  const jobs = await db.listJobsForUser(userId);
  const hourAgo = Date.now() - 60 * 60 * 1000;
  return jobs.filter((job) => +new Date(job.createdAt) >= hourAgo).length;
}

function empty(state: GatingState, required: number): Eligibility {
  return {
    state,
    balance: null,
    required,
    remainingToday: null,
    dailyLimit: TOKEN_GATING.tiers[0].hourlyGenerations,
    tier: null,
  };
}
