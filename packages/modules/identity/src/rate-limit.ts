import { newId } from "@igs/db/ids";
import type { KernelRuntime } from "@igs/kernel";
import { sql } from "drizzle-orm";

import { rateLimits } from "./schema";

/** One limit: at most `max` hits per `windowSeconds`, counted per key. */
export interface RateLimit {
  readonly windowSeconds: number;
  readonly max: number;
}

/**
 * Counts one hit against `key` and says whether it is allowed (igs-pharma#199). Shares
 * `identity.rate_limits` with Better Auth's limiter (every app instance sees the same counts), under
 * keys of its own (`igs:<flow>:<who>`, so they never collide with Better Auth's). A fixed window: the
 * first hit after a window ended starts a new one. One atomic statement, so two parallel requests
 * cannot both slip under the limit. A key holds an id or an address, never anything else personal.
 */
export async function consumeRateLimit(
  db: KernelRuntime["db"],
  key: string,
  limit: RateLimit,
  now: Date,
): Promise<boolean> {
  const nowMs = now.getTime();
  const windowStart = nowMs - limit.windowSeconds * 1000;
  const rows = await db.transaction((tx) =>
    tx
      .insert(rateLimits)
      .values({ id: newId(), key, count: 1, lastRequest: nowMs })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`CASE WHEN ${rateLimits.lastRequest} <= ${windowStart} THEN 1 ELSE ${rateLimits.count} + 1 END`,
          lastRequest: sql`CASE WHEN ${rateLimits.lastRequest} <= ${windowStart} THEN ${nowMs} ELSE ${rateLimits.lastRequest} END`,
        },
      })
      .returning({ count: rateLimits.count }),
  );
  return (rows[0]?.count ?? Number.POSITIVE_INFINITY) <= limit.max;
}
