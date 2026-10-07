import { sha256Hex } from "@igs/crypto";

import { type Canonical, canonicalJson } from "./canonical";

/** `prev_hash` of the very first event: 64 zeros. */
export const GENESIS_HASH = "0".repeat(64);

/** Every column of `audit.events` except `hash` (D-026): this is exactly what is hashed. */
export interface EventCore {
  readonly id: string;
  readonly at: Date;
  readonly seq: number;
  readonly actorType: string;
  readonly actorId: string;
  readonly action: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly locationId: string | null;
  readonly ipHash: string | null;
  readonly uaHash: string | null;
  readonly data: { readonly [key: string]: Canonical };
  readonly prevHash: string;
}

/** Timestamps are truncated to milliseconds so a Postgres round trip (µs) verifies. */
export const truncateToMs = (date: Date): Date => new Date(Math.trunc(date.getTime()));

/** The object that gets canonicalised: snake_case column names, `at` as UTC ISO-8601 with ms. */
export function canonicalEvent(core: EventCore): Canonical {
  return {
    action: core.action,
    actor_id: core.actorId,
    actor_type: core.actorType,
    at: truncateToMs(core.at).toISOString(),
    data: core.data,
    entity_id: core.entityId,
    entity_type: core.entityType,
    id: core.id,
    ip_hash: core.ipHash,
    location_id: core.locationId,
    prev_hash: core.prevHash,
    seq: core.seq,
    ua_hash: core.uaHash,
  };
}

/** `hash = sha256(canonical_json(event_without_hash) || prev_hash)`, hex. */
export function computeHash(core: EventCore): string {
  return sha256Hex(canonicalJson(canonicalEvent(core)) + core.prevHash);
}
