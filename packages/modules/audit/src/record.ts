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
  /** `AUDIT_HMAC_KEY` (≥ 32 chars). */
  readonly hmacKey: string;
  /** Prefix stored with each hash so a key rotation stays unambiguous (`v1:<hex>`). */
  readonly hmacKeyVersion?: string;
}

const MIN_KEY_LENGTH = 32;

function keyedHash(options: RecordOptions, value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
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
  if (options.hmacKey.length < MIN_KEY_LENGTH) throw invariant("audit.hmac_key_too_short");
  if (event.actor.id === "") throw invariant("audit.invalid_actor");
  const data = parseAuditData(event.action, event.data);

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
    ipHash: keyedHash(options, event.origin?.ip),
    uaHash: keyedHash(options, event.origin?.userAgent),
    data,
    prevHash: head.hash,
  };
  const hash = computeHash(core);

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
  await tx.update(chainHead).set({ seq: core.seq, hash }).where(eq(chainHead.id, 1));
  return { seq: core.seq, hash };
}
