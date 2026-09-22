import { Connection } from "@solana/web3.js";
import { env } from "@/lib/config/env";

export function getSolanaConnection() {
  return new Connection(env.solanaRpc, "confirmed");
}
