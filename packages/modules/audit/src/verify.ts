import type { Db } from "@igs/db";
import { type Tx, invariant } from "@igs/kernel";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";

import { GENESIS_HASH, computeHash } from "./chain";
import { events, chainHead } from "./schema";

export type VerifyFailure =
  | "hash_mismatch" // a stored hash differs from the recomputed one (row altered)
  | "prev_hash_mismatch" // the link to the previous event is broken
  | "seq_gap" // a position is missing or duplicated (row deleted/inserted)
  | "head_mismatch"; // the newest event does not match `audit.chain_head` (tail removed/head altered)

export type ChainVerification =
  | {
      readonly ok: true;
      readonly checked: number;
      readonly headSeq: number;
      readonly headHash: string;
    }
  | {
      readonly ok: false;
      readonly checked: number;
      readonly firstBadSeq: number;
      readonly reason: VerifyFailure;
    };

export interface VerifyRange {
  /**
   * Start after this recorded checkpoint instead of genesis (retention removes old partitions,
   * B-03). The first verified event must link to `hash` and have `seq = checkpoint.seq + 1`.
   * Not implemented beyond this hook: nothing records checkpoints yet.
   */
  readonly fromCheckpoint?: { readonly seq: number; readonly hash: string };
  /** Verify only events with `at >= sinceAt` (the daily 48 h job); linked to their predecessor. */
  readonly sinceAt?: Date;
  /** Inclusive upper bound; when omitted the newest event is also checked against the chain head. */
  readonly toSeq?: number;
}

const BATCH = 1000;

type Reader = Pick<Tx, "select" | "execute">;

/**
 * Walks the chain and recomputes every hash. Detects altered rows, broken links, gaps/duplicates
 * and removal of the newest events (via the head row). Reads only; safe to run on the app role.
 *
 * **Must run in ONE snapshot.** The walk, the head read and the newest-row read are separate
 * statements; under READ COMMITTED each would see a new snapshot, and a `record` committing in
 * between (normal traffic) would produce a false `head_mismatch`: an integrity alarm that cries
 * wolf. So the transaction must be REPEATABLE READ or SERIALIZABLE, otherwise this throws
 * `audit.verify_requires_snapshot`. Caller pattern (readers neither block nor are blocked by writers):
 *
 *     db.transaction((tx) => verifyChain(tx, range), {
 *       isolationLevel: "repeatable read",
 *       accessMode: "read only",
 *     });
 *
 * (`verifyChainSnapshot` does exactly that.)
 */
export async function verifyChain(db: Reader, range: VerifyRange = {}): Promise<ChainVerification> {
  const isolation = await db.execute<{ level: string }>(
    sql`SELECT current_setting('transaction_isolation') AS level`,
  );
  const level = Array.from(isolation)[0]?.level;
  if (level !== "repeatable read" && level !== "serializable") {
    throw invariant("audit.verify_requires_snapshot", { isolation: level ?? "unknown" });
  }

  // ── where to start ──────────────────────────────────────────────────────────────────────────
  let nextSeq = 1;
  let expectedPrev = GENESIS_HASH;
  if (range.fromCheckpoint) {
    nextSeq = range.fromCheckpoint.seq + 1;
    expectedPrev = range.fromCheckpoint.hash;
  } else if (range.sinceAt) {
    const [first] = await db
      .select({ seq: events.seq })
      .from(events)
      .where(gte(events.at, range.sinceAt))
      .orderBy(asc(events.seq))
      .limit(1);
    if (first && first.seq > 1) {
      const [previous] = await db
        .select({ hash: events.hash })
        .from(events)
        .where(eq(events.seq, first.seq - 1));
      nextSeq = first.seq;
      // a missing predecessor makes the first link unverifiable → reported as a gap below
      expectedPrev = previous?.hash ?? "";
    } else if (first) {
      nextSeq = first.seq;
    } else {
      nextSeq = Number.POSITIVE_INFINITY; // nothing in the window; only the head check remains
    }
  }

  let checked = 0;
  let lastSeq = nextSeq - 1;
  let lastHash = expectedPrev;
  const upper = range.toSeq ?? Number.MAX_SAFE_INTEGER;

  // ── walk ────────────────────────────────────────────────────────────────────────────────────
  while (Number.isFinite(nextSeq) && nextSeq <= upper) {
    const rows = await db
      .select()
      .from(events)
      .where(and(gte(events.seq, nextSeq), lte(events.seq, Math.min(upper, nextSeq + BATCH - 1))))
      .orderBy(asc(events.seq));
    if (rows.length === 0) break;
    for (const row of rows) {
      if (row.seq !== nextSeq) return fail(checked, nextSeq, "seq_gap");
      if (row.prevHash !== expectedPrev) return fail(checked, row.seq, "prev_hash_mismatch");
      const recomputed = computeHash({
        id: row.id,
        at: row.at,
        seq: row.seq,
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        locationId: row.locationId,
        ipHash: row.ipHash,
        uaHash: row.uaHash,
        data: row.data as Record<string, string | number | boolean | null>,
        prevHash: row.prevHash,
      });
      if (recomputed !== row.hash) return fail(checked, row.seq, "hash_mismatch");
      checked++;
      expectedPrev = row.hash;
      lastSeq = row.seq;
      lastHash = row.hash;
      nextSeq = row.seq + 1;
    }
  }

  // ── newest event vs chain head (catches deleted tail rows and a rewritten head) ──────────────
  const [head] = await db.select().from(chainHead).where(eq(chainHead.id, 1));
  if (!head) return fail(checked, 0, "head_mismatch");
  if (range.toSeq === undefined) {
    const [newest] = await db.select().from(events).orderBy(desc(events.seq)).limit(1);
    const newestSeq = newest?.seq ?? 0;
    const newestHash = newest?.hash ?? GENESIS_HASH;
    if (newestSeq !== head.seq || newestHash !== head.hash) {
      return fail(checked, Math.min(newestSeq, head.seq) + 1, "head_mismatch");
    }
    if (checked > 0 && (lastSeq !== head.seq || lastHash !== head.hash)) {
      return fail(checked, lastSeq + 1, "head_mismatch");
    }
  }
  return { ok: true, checked, headSeq: head.seq, headHash: head.hash };
}

function fail(checked: number, firstBadSeq: number, reason: VerifyFailure): ChainVerification {
  return { ok: false, checked, firstBadSeq, reason };
}

/** `verifyChain` in its own REPEATABLE READ, read-only transaction (the snapshot it requires). */
export function verifyChainSnapshot(
  db: Pick<Db, "transaction">,
  range: VerifyRange = {},
): Promise<ChainVerification> {
  return db.transaction((tx) => verifyChain(tx, range), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}
