# Audit log (`@igs/module-audit`)

Append-only, hash-chained audit trail (REQ-SEC-03 tamper evidence, REQ-PHC-05 attributable pharmacist
decisions). Decisions: D-026 (single chain), D-027 (append-only in Postgres), D-028 (PII rules,
canonical JSON, golden vectors), D-029 (partitions). Requirements: `security-architecture.md` §4.

## What is stored

`audit.events` (Postgres schema `audit`, partitioned monthly by `at`, UTC months):

| column | notes |
|---|---|
| `id` uuid (v7), `at` timestamptz | primary key `(id, at)`; `at` is truncated to milliseconds |
| `seq` bigint | position in the chain: **1, 2, 3 … gap-free** |
| `actor_type`, `actor_id` | `user` / `system` / `webhook` / `anonymous` (anonymous ids are server-issued) |
| `action` | `<domain>.<noun>.<verb>` (regex `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`), must be registered |
| `entity_type`, `entity_id`, `location_id` | nullable |
| `ip_hash`, `ua_hash` | `v1:<hex>` = HMAC-SHA256 under `AUDIT_HMAC_KEY`; **never the raw value** |
| `data` jsonb | allow-listed shape per action (below); identifiers and status only |
| `prev_hash`, `hash` | the chain |

`audit.chain_head` is a single row `(id = 1, seq, hash)`, genesis `(0, 64 × "0")`.

## The chain

```
hash = hex( sha256( canonical_json(event_without_hash) || prev_hash ) )
```

* **`event_without_hash` = every column except `hash`**, including `seq` and `prev_hash`
  (D-026): `action, actor_id, actor_type, at, data, entity_id, entity_type, id, ip_hash,
  location_id, prev_hash, seq, ua_hash` (snake_case column names; `at` as UTC ISO-8601 with
  milliseconds, e.g. `2026-01-02T03:04:05.678Z`; SQL NULL = JSON `null`).
* `||` is plain string concatenation of the canonical JSON text and the 64-hex `prev_hash`;
  the input is UTF-8.
* The first event has `prev_hash` = `0` × 64 and `seq` = 1.

### Canonical JSON

UTF-8, no whitespace; object keys sorted by **UTF-16 code unit**; strings escaped exactly as
`JSON.stringify`; **numbers must be safe integers** (floats, `NaN`, `Infinity` are rejected);
`null` kept; object keys with value `undefined` dropped; `undefined` in an array is an error.

### Golden test vectors

Produced by an independent (Python) reference implementation, pinned in
`packages/modules/audit/test/canonical.test.ts`. A reimplementation must reproduce them.

```
canonical({"é":1,"b":"xé\n\"","a":[1,null,true,{"y":2,"x":-3}]})
  = {"a":[1,null,true,{"x":-3,"y":2}],"b":"xé\n\"","é":1}

canonical({"😀":1,"￿":2,"a":3})              (UTF-16 order: astral before U+FFFF)
  = {"a":3,"😀":1,"￿":2}

event   id=018f0000-0000-7000-8000-000000000001  at=2026-01-02T03:04:05.678Z  seq=1
        actor user/user-1  action pharmacy.review.decided  entity order/o-1  location null
        ip_hash "v1:abc"  ua_hash null  prev_hash 0×64
        data {"decision":"approved","orderId":"o-1","z":1,"a":true,"n":null}
canonical = {"action":"pharmacy.review.decided","actor_id":"user-1","actor_type":"user","at":"2026-01-02T03:04:05.678Z","data":{"a":true,"decision":"approved","n":null,"orderId":"o-1","z":1},"entity_id":"o-1","entity_type":"order","id":"018f0000-0000-7000-8000-000000000001","ip_hash":"v1:abc","location_id":null,"prev_hash":"0000000000000000000000000000000000000000000000000000000000000000","seq":1,"ua_hash":null}
hash      = fd446d39cbf681c3cc4245d177eb05b80f65a7cc8450d0dfccc6ddcf3e646e98
```

## Writing: `record(tx, event, { hmacKey })`

Inside the command's transaction: lock the head row `FOR UPDATE`, compute `seq = head.seq + 1`, insert
the event, advance the head. The lock serialises appends (throughput is irrelevant at the expected
~100 orders/day) and is held **until the transaction commits** — which is why T-006b makes the
kernel buffer `ctx.audit.record` entries and flush them right before commit. Event and head commit or
roll back together with the handler. Apps wire it with
`configureKernel({ audit: createAuditPort({ hmacKey: env.AUDIT_HMAC_KEY }) })`.

### PII rules

* `data` is validated against a **per-action Zod schema** (`registerAuditAction(action, z.object({…}))`).
  Unknown actions are rejected (fail closed), unknown keys are rejected (the schema is strict), and
  values may only be strings, safe integers, booleans or null.
* No health data, no secrets, no free-text customer input, no names/e-mails/addresses.
* IP and user agent are **never** stored raw: only `v1:<hmac>`. The prefix is the key version, so a
  key rotation does not make old hashes ambiguous. Handlers never see raw IP/UA; the edge adapter
  passes them as `origin` (T-006b adds `CallOptions.origin`).
* `AUDIT_HMAC_KEY` (≥ 32 chars) is a runtime-only secret (D-023); KMS-wrapped later (B-04).

## Append-only in the database (D-027)

1. The runtime role **`igs_app`** (NOLOGIN group role created by the migration) holds only
   `SELECT, INSERT` on `audit.events` and `SELECT, UPDATE` on `audit.chain_head`
   (the head is advanced, never created or deleted), plus `EXECUTE` on `audit.future_partitions()`.
   No UPDATE/DELETE/TRUNCATE on events, no DDL, no `ensure_partitions`.
2. **Grants mean nothing for the table owner.** The runtime application user must **never own
   `audit.*`**: objects are owned by the migrator role, and the app's login role is a member of
   `igs_app` only (login-role mapping: B-08).
3. Defence in depth: `BEFORE UPDATE OR DELETE` row triggers (cloned onto every partition) and
   `BEFORE TRUNCATE` statement triggers (parent and every partition) raise `insufficient_privilege`
   — they stop even the owner and superusers (unless they disable triggers on purpose, which
   `verifyChain` then detects).

## Verifying: `verifyChain(db, range?)`

Recomputes every hash and checks `seq` contiguity, the `prev_hash` link, and finally that the newest
event equals `audit.chain_head` (detects deleted tail rows and a rewritten head). Failures report
`firstBadSeq` and a reason: `hash_mismatch`, `prev_hash_mismatch`, `seq_gap`, `head_mismatch`.

Ranges: `toSeq`; `sinceAt` (the daily job verifies the last 48 h, linked to the predecessor of the
first event in the window); `fromCheckpoint: { seq, hash }` — the hook for retention (B-03): when old
partitions are removed, verification starts from a recorded checkpoint instead of genesis.
Nothing records checkpoints yet. Partitions are never dropped inside the retention window.

Not verifiable by the chain alone: someone with database superuser **and** the ability to recompute
and rewrite every later hash plus the head. That is what B-09 (anchoring the daily head hash in
object-lock storage) closes.

## Partitions (D-029)

Monthly by UTC month, named `audit.events_yYYYYmMM`. `audit.ensure_partitions(months_ahead)` creates
missing ones (idempotent, 0–24); the migration creates the current month + 3. There is **no DEFAULT
partition**: an event outside every partition **fails** (fail closed — a missing partition must
page someone, not silently lose or misplace audit data). `audit.future_partitions()` returns how many
whole months after the current one exist; alert when it is below **2**. A daily job under the
maintenance role calls `ensure_partitions(3)` (T-006b; the maintenance credentials come with B-08).

## Retention classes (gdpr-and-privacy §5)

| class | retention |
|---|---|
| audit of access to / decisions on **health data** | 10 years |
| technical audit (auth, settings, exports …) | 2 years |

Both live in the same chain; retention removes whole partitions only after the class's period and
records a checkpoint first (B-03).

## What is logged

Auth events, role changes, every read of C4 data, pharmacist decisions, price and promotion changes,
refunds, exports, DSR actions, settings changes (security-architecture §4). Each owning module
registers its actions and data shapes.
