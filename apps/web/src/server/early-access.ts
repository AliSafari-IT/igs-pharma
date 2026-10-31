import "server-only";

import { getKernelRuntime } from "@igs/kernel";
import { type RateLimit, consumeRateLimit } from "@igs/module-identity";

import { ensureKernelConfigured } from "./kernel";

/**
 * Whether this hit is within every limit (igs-pharma#199). Each key is counted even when an earlier
 * one already refused, so a client that keeps trying stays refused. `ip` may be missing (no edge
 * header): then only the account is counted.
 */
export async function withinLimits(
  checks: readonly { readonly key: string | null; readonly limit: RateLimit }[],
): Promise<boolean> {
  await ensureKernelConfigured();
  const { db } = getKernelRuntime();
  const now = new Date();
  let allowed = true;
  for (const { key, limit } of checks) {
    if (key === null) continue;
    if (!(await consumeRateLimit(db, key, limit, now))) allowed = false;
  }
  return allowed;
}
