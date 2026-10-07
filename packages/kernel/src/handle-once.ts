import { type Tx, getKernelConfig } from "./config";
import { idempotencyKeys } from "./schema";

const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * At-least-once → effectively-once for event subscribers: claims `event:{eventId}:{subscriber}`
 * in `system.idempotency_keys` and runs `fn` in the SAME transaction, so the claim and the
 * subscriber's writes commit (or roll back and are retried) together. Returns `undefined` when the
 * event was already handled for this subscriber.
 *
 * Like command handlers, `fn` must not perform external I/O (D-019): side effects go via the outbox.
 */
export async function handleOnce<T>(
  eventId: string,
  subscriber: string,
  fn: (tx: Tx) => Promise<T>,
  options: { ttlMs?: number } = {},
): Promise<T | undefined> {
  const config = getKernelConfig();
  const now = config.clock();
  const key = `event:${eventId}:${subscriber}`;
  return config.db().transaction(async (tx) => {
    const claimed = await tx
      .insert(idempotencyKeys)
      .values({
        key,
        createdAt: now,
        expiresAt: new Date(now.getTime() + (options.ttlMs ?? DEFAULT_TTL_MS)),
      })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });
    if (claimed.length === 0) return undefined;
    return fn(tx);
  });
}
