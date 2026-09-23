import type { TokenTier } from "@/types";
import { env } from "./env";
import { modelsAllowedForTier } from "./models";

/**
 * Server-side token-gating configuration.
 * Thresholds live here (and in env) — never inside UI components.
 *
 * Holding GENER8 is an access requirement, not a burn/transfer.
 * Tiers can be extended without changing generation UI.
 */
export const TOKEN_GATING = {
  symbol: env.tokenSymbol,
  mint: env.tokenMint,
  decimals: env.tokenDecimals,
  getTokenUrl: env.getTokenUrl,
  tiers: [
    {
      id: 1,
      name: "Access",
      label: "Access",
      minimumBalance: 50_000,
      hourlyGenerations: 1,
      dailyGenerations: 1,
      models: modelsAllowedForTier(1),
    },
    {
      id: 2,
      name: "Creator",
      label: "Creator",
      minimumBalance: 100_000,
      hourlyGenerations: 3,
      dailyGenerations: 3,
      models: modelsAllowedForTier(2),
    },
    {
      id: 3,
      name: "Studio",
      label: "Studio",
      minimumBalance: 300_000,
      hourlyGenerations: null,
      dailyGenerations: 10_000,
      models: modelsAllowedForTier(3),
    },
  ] satisfies TokenTier[],
} as const;

export function tierForBalance(balance: number): TokenTier | null {
  const eligible = [...TOKEN_GATING.tiers]
    .reverse()
    .find((tier) => balance >= tier.minimumBalance);
  return eligible ?? null;
}

export function minimumAccessBalance() {
  return TOKEN_GATING.tiers[0].minimumBalance;
}

/** Operator accounts that skip the token hold. Nobody else is on this list. */
const FULL_ACCESS_USERNAMES = new Set(["gener8"]);

export function isFullAccessUsername(username?: string | null) {
  return Boolean(username && FULL_ACCESS_USERNAMES.has(username.trim().toLowerCase()));
}

export function fullAccessTier(): TokenTier {
  const studio = TOKEN_GATING.tiers[TOKEN_GATING.tiers.length - 1];
  return {
    ...studio,
    dailyGenerations: 10_000,
    models: modelsAllowedForTier(studio.id),
  };
}
