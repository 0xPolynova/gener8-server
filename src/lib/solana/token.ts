import { env } from "@/lib/config/env";
import { AppError, ERROR_CODES } from "@/lib/errors";

function heliusRpcUrl() {
  if (env.heliusApiKey) {
    return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(env.heliusApiKey)}`;
  }
  if (env.solanaRpc.includes("helius-rpc.com")) return env.solanaRpc;
  return "";
}

/** Live wallet balance for the GENER8 mint, read from Helius at call time. */
export async function getGener8Balance(walletAddress: string): Promise<number> {
  if (!env.tokenMint) return 0;
  const url = heliusRpcUrl();
  if (!url) {
    throw new AppError(
      ERROR_CODES.RPC_FAILURE,
      503,
      "Helius is not configured for the token balance check.",
    );
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "gener8-balance",
        method: "getTokenAccountsByOwner",
        params: [walletAddress, { mint: env.tokenMint }, { encoding: "jsonParsed" }],
      }),
    });
    if (!response.ok) throw new Error(`Helius HTTP ${response.status}`);
    const body = (await response.json()) as {
      error?: { message?: string };
      result?: {
        value?: {
          account?: {
            data?: {
              parsed?: {
                info?: {
                  tokenAmount?: { uiAmount?: number | null; amount?: string; decimals?: number };
                };
              };
            };
          };
        }[];
      };
    };
    if (body.error) throw new Error(body.error.message || "Helius balance request failed");
    let total = 0;
    for (const item of body.result?.value ?? []) {
      const amount = item.account?.data?.parsed?.info?.tokenAmount;
      if (!amount) continue;
      if (typeof amount.uiAmount === "number") {
        total += amount.uiAmount;
        continue;
      }
      const raw = Number(amount.amount ?? 0);
      const decimals = amount.decimals ?? env.tokenDecimals;
      if (Number.isFinite(raw)) total += raw / 10 ** decimals;
    }
    return total;
  } catch (error) {
    console.error("Helius balance read failed", error instanceof Error ? error.message : "request failed");
    if (error instanceof AppError) throw error;
    throw new AppError(ERROR_CODES.RPC_FAILURE, 503);
  }
}
