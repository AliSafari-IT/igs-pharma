import { createHash, timingSafeEqual } from "node:crypto";

/** SHA-256 of a string, returned as hex. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Constant-time equality for HMAC comparison. */
export function safeEqual(a: string, b: string): boolean {
  const aBytes = Buffer.from(a, "utf8");
  const bBytes = Buffer.from(b, "utf8");
  if (aBytes.length !== bBytes.length) return false;
  return timingSafeEqual(aBytes, bBytes);
}
