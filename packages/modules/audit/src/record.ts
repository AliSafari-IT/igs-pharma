import { hmacSha256Hex } from "@igs/crypto";
import { newId } from "@igs/db/ids";
import { type Actor, type Tx, invariant } from "@igs/kernel";
import { eq } from "drizzle-orm";

import { parseAuditData } from "./actions";
import { type EventCore, computeHash, truncateToMs } from "./chain";
import { events, chainHead } from "./schema";

export interface AuditEvent {
  readonly at: Date;
  readonly actor: Pick<Actor, "type" | "id">;
  /** `<domain>.<noun>.<verb>`; must be registered with `registerAuditAction`. */
  readonly action: string;
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly locationId?: string | undefined;
  /** Raw IP / user agent, set by the edge adapter; only keyed hashes are stored. */
  readonly origin?:
    | { readonly ip?: string | undefined; readonly userAgent?: string | undefined }
    | undefined;
  readonly data?: Readonly<Record<string, unknown>> | undefined;
}

export interface RecordOptions {
  /**
   * `AUDIT_HMAC_KEY` (≥ 32 chars). Optional: processes that never see an `origin` (the worker)
   * don't hold it. An event WITH an origin and no key fails closed (`audit.origin_without_key`),
   * raw IP / user agent are never stored.
   */
  readonly hmacKey?: string | undefined;
  /** Prefix stored with each hash so a key rotation stays unambiguous (`v1:<hex>`). */
  readonly hmacKeyVersion?: string;
}

const MIN_KEY_LENGTH = 32;

function sqlState(error: unknown): string | undefined {
  for (let e: unknown = error, depth = 0; e && depth < 4; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

function keyedHash(options: RecordOptions, value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  if (options.hmacKey === undefined) throw invariant("audit.origin_without_key");
  return `${options.hmacKeyVersion ?? "v1"}:${hmacSha256Hex(options.hmacKey, value)}`;
}

/**
 * Appends one event to the hash chain **inside the caller's transaction** `tx`.
 *
 * Locks the chain-head row (`FOR UPDATE`), so appends serialise and `seq` stays gap-free; the lock
 * is held until `tx` commits (D-026). Throws a `DomainError` for an unknown action or invalid data.
 * Returns the stored `seq` and `hash`.
 */
export async function record(
  tx: Tx,
  event: AuditEvent,
  options: RecordOptions,
): Promise<{ seq: number; hash: string }> {
  if (options.hmacKey !== undefined && options.hmacKey.length < MIN_KEY_LENGTH) {
    throw invariant("audit.hmac_key_too_short");
  }
  if (event.actor.id === "") throw invariant("audit.invalid_actor");
  const data = parseAuditData(event.action, event.data);
  // before the chain lock: a missing key must not hold it
  const ipHash = keyedHash(options, event.origin?.ip);
  const uaHash = keyedHash(options, event.origin?.userAgent);

  const [head] = await tx.select().from(chainHead).where(eq(chainHead.id, 1)).for("update");
  if (!head) throw invariant("audit.chain_head_missing");

  const core: EventCore = {
    id: newId(),
    at: truncateToMs(event.at),
    seq: head.seq + 1,
    actorType: event.actor.type,
    actorId: event.actor.id,
    action: event.action,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    locationId: event.locationId ?? null,
    ipHash,
    uaHash,
    data,
    prevHash: head.hash,
  };
  const hash = computeHash(core);

  try {
    await tx.insert(events).values({
      id: core.id,
      at: core.at,
      seq: core.seq,
      actorType: core.actorType,
      actorId: core.actorId,
      action: core.action,
      entityType: core.entityType,
      entityId: core.entityId,
      locationId: core.locationId,
      ipHash: core.ipHash,
      uaHash: core.uaHash,
      data: core.data,
      prevHash: core.prevHash,
      hash,
    });
  } catch (error) {
    // jsonb cannot store \u0000 / lone surrogates: a data problem, not an infrastructure failure
    const code = sqlState(error);
    if (code === "22P05" || code === "22021" || code === "22P02") {
      throw invariant("audit.invalid_data", { action: event.action });
    }
    throw error;
  }
  await tx.update(chainHead).set({ seq: core.seq, hash }).where(eq(chainHead.id, 1));
  return { seq: core.seq, hash };
}
