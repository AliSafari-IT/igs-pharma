import "server-only";

import { getKernelRuntime } from "@igs/kernel";
import { type RateLimit, consumeRateLimit } from "@igs/module-identity";

import { ensureKernelConfigured } from "./kernel";

/**
 * Whether this hit is within every limit (igs-pharma#199). Each key is counted even when an earlier
 * one already refused, so a client that keeps trying stays refused.
 */
export async function withinLimits(
  checks: readonly { readonly key: string; readonly limit: RateLimit }[],
): Promise<boolean> {
  await ensureKernelConfigured();
  const { db } = getKernelRuntime();
  const now = new Date();
  let allowed = true;
  for (const { key, limit } of checks) {
    if (!(await consumeRateLimit(db, key, limit, now))) allowed = false;
  }
  return allowed;
}

/**
 * The per-address key of a flow. A request without the edge's address header (never through the
 * edge) shares ONE bucket per flow: it is still limited, never let through uncounted.
 */
export const ipKey = (flow: string, ip: string | undefined): string =>
  `igs:early-access:${flow}:ip:${ip ?? "unknown"}`;
