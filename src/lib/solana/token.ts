import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import { env } from "@/lib/config/env";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { getSolanaConnection } from "./connection";

export async function getGener8Balance(walletAddress: string): Promise<number> {
  if (!env.tokenMint) return 0;

  try {
    const connection = getSolanaConnection();
    return await readSplBalance(connection, walletAddress);
  } catch (error) {
    console.error("SPL balance read failed", error);
    throw new AppError(ERROR_CODES.RPC_FAILURE, 503);
  }
}

async function readSplBalance(connection: Connection, walletAddress: string) {
  const mint = new PublicKey(env.tokenMint);
  const owner = new PublicKey(walletAddress);
  const ata = await getAssociatedTokenAddress(mint, owner);

  try {
    const account = await getAccount(connection, ata);
    const raw = Number(account.amount);
    return raw / 10 ** env.tokenDecimals;
  } catch {
    return 0;
  }
}
