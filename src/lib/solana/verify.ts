import nacl from "tweetnacl";
import bs58 from "bs58";

export function verifyWalletSignature(params: {
  wallet: string;
  message: string;
  signature: string;
}) {
  try {
    const message = new TextEncoder().encode(params.message);
    const publicKey = bs58.decode(params.wallet);
    if (publicKey.length !== 32) return false;
    for (const signature of decodeSignatureCandidates(params.signature)) {
      if (signature.length !== 64) continue;
      if (nacl.sign.detached.verify(message, signature, publicKey)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function decodeSignatureCandidates(signature: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  try {
    out.push(bs58.decode(signature));
  } catch {
    /* not bs58 */
  }
  try {
    out.push(new Uint8Array(Buffer.from(signature, "base64")));
  } catch {
    /* not base64 */
  }
  try {
    out.push(new Uint8Array(Buffer.from(signature, "base64url")));
  } catch {
    /* not base64url */
  }
  return out;
}
