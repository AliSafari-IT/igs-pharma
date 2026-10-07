# Kernel (`@igs/kernel`)

Every state change goes through a **command**; every read through a **query**. Server Actions,
route handlers and jobs call them — never tables (D-005, D-015). The kernel is infrastructure: it
imports only `db`, `auth`, `observability` and `config`, **never a module** (D-004). Modules
implement kernel *ports* (e.g. `AuditPort`) and each app wires them in.

## Execution order (the invariant)

```
span start → authorize → parse input (Zod) → open ONE transaction
           → idempotency check → handler → audit guard → output parse → flush buffered audit → commit → span end
```

- Authorization and parsing happen **before the transaction opens**: a rejected call does no database work. **Authorization comes first (K1)**, so an unauthorised caller gets `kernel.forbidden` and learns nothing about the input schema (no field paths).
- Everything in the handler — your writes, the audit entry, the outbox event — commits or rolls back **together**.
- Any throw inside the transaction (a `DomainError` or anything else) rolls it back and is re-thrown.
- Default isolation `READ COMMITTED`; use optimistic `version` checks in handlers. On `40001` (serialization failure) or `40P01` (deadlock) the kernel **retries the whole execution** (default: up to 3 retries, exponential backoff with jitter) and records the metric `kernel.tx.retry`. Retrying is safe only because of the next rule.

## Rules for handlers

1. **No external I/O inside a handler (D-019)**: no HTTP, PSP, e-mail or file-storage calls. Side effects leave through the outbox (below), which is what makes retries and rollbacks safe.
2. **No PII or health data** in audit `data`, idempotent outputs, outbox payloads, spans or logs (D-020). Carry identifiers and status.
3. **Don't call another command's function directly** inside a handler: it throws `kernel.nested_command`. Use `ctx.run(otherCommand, input)`, which joins your transaction (authorization and audit are enforced per command). Queries can't be called from inside a handler either; read through `ctx.tx`.
4. Use `ctx.can(permission)` for resource-level checks (ownership, location). The command-level permission is already enforced.
5. **`.own` permissions need an ownership check (K3).** `orders.read.own` (customers) means "my own orders": a handler using it must verify the resource belongs to `ctx.actor.id`. `orders.read` is the staff-wide permission. B-02 generalises `.own`/`.any` scopes.
6. **Pharmacist-only permissions (K2, D-030).** `orders.review.decide` is never implied by `owner` or an administrative role; someone who is both owner and pharmacist holds both roles.

## Defining a command

```ts
import { command } from "@igs/kernel";
import { z } from "zod";

export const approveReview = command({
  name: "orders.review.approve",              // <module>.<entity>.<verb>; also the span name
  input: z.object({ orderId: z.string().min(1) }),
  output: z.object({ orderId: z.string(), status: z.string() }), // required when idempotent
  permission: "orders.review.decide",         // or "public" (see below)
  async handler({ input, ctx }) {
    // ... your writes through ctx.tx (Drizzle transaction) ...
    await ctx.audit.record({
      action: "pharmacy.review.decided",
      entityType: "order",
      entityId: input.orderId,
      data: { decision: "approved" },          // non-PII only
    });
    return { orderId: input.orderId, status: "ready_for_fulfilment" };
  },
});

// at the edge (a Server Action / route handler), with a server-resolved actor:
const result = await approveReview({ orderId }, actor, { idempotencyKey });
```

This exact example runs in `packages/kernel/test/example.test.ts` — keep both in sync.

| Field | Meaning |
|---|---|
| `input` | Zod schema; failures become `ValidationFailed` carrying `{ path, code }` per field — **never the values**. |
| `output` | Parsed before returning (unknown keys are **stripped**). Required if the command accepts an `idempotencyKey`. |
| `permission` | A permission from `@igs/auth/permissions`, or `"public"`. |
| `audit` | Default `"required"`: a handler that records nothing fails with `InvariantViolation(kernel.audit_missing)` and rolls back. `"none"` opts out (use sparingly, e.g. a pure computation). |

`query({ name, input, permission, handler })` is the read-only twin: authorization-checked, runs in a
`READ ONLY` transaction, no audit by default (`auditRead` is reserved for health-data access auditing and
throws if set to `true` for now).

## Actor

```ts
type ActorType = "user" | "system" | "webhook" | "anonymous";
interface Actor { type: ActorType; id: string; roles: readonly string[] }
```

Always explicit — never read from ambient state inside handlers. **`roles` must be resolved server-side**
(session/DB) by the edge adapter, never taken from client input (D-005). `anonymous` (guest cart/checkout)
has a server-issued id, its roles are ignored, and it can only run `permission: "public"` operations.

### Public operations (A1)

`permission: "public"` is allowed **only** for the operations listed here. Each needs a test showing it works
for an anonymous actor and that it audits with `actor_type = anonymous`.

| Operation | Why it is public |
|---|---|
| *(none yet)* | |

## Errors (D-006)

`DomainError` has a `kind`, a stable `code` (`<module>.<reason>`; the kernel's are `kernel.*`), optional non-PII
`details` and validation `fields`. **No user-facing text anywhere in the kernel**; the edge maps `code` to a
translated message (next-intl).

| Kind | HTTP | Typical use |
|---|---|---|
| `ValidationFailed` | 422 | bad input (`kernel.validation_failed`, `kernel.invalid_idempotency_key`) |
| `Forbidden` | 403 | not allowed (`kernel.forbidden`) |
| `NotFound` | 404 | missing resource |
| `Conflict` | 409 | state conflict (`kernel.idempotency_in_progress`) |
| `InvariantViolation` | 500 | "should never happen" (`kernel.audit_missing`, `kernel.nested_command`, `kernel.output_schema_required`) |
| *anything else* | 500 `kernel.internal` | the original is logged (name, message, stack — never input values) |

At the edge: `const { status, code, details, fields } = toErrorResponse(error)` — no text.

## Idempotency

`command(...)(raw, actor, { idempotencyKey })` stores the key as `"{command.name}:{actor.id}:{key}"` in
`system.idempotency_keys` **inside the command's transaction**:

- a duplicate returns the stored response **without running the handler**;
- two concurrent duplicates: the second blocks on the unique row until the first transaction ends, then replays its response (the handler runs once);
- a failed (rolled-back) execution does **not** consume the key;
- rows expire after 24 h (an expired key is reclaimed and the command runs again; purge of old rows comes with B-03).

**A4 — the stored response is plaintext:** an idempotent command's `output` schema carries **identifiers and
status only** (the schema strips everything else). **Request hash (K4):** the key row stores
`sha256(canonical JSON of the parsed input)`; replaying a key with a *different* input is rejected with
`Conflict("kernel.idempotency_key_reused")` and the handler does not run. An idempotent command whose output
serialises to `undefined` is rejected (`kernel.idempotent_output_undefined`) and rolled back, because it would
leave the key "in progress" forever.

## Wiring (composition root)

```ts
import { configureKernel } from "@igs/kernel";

configureKernel({ audit: auditPort }); // once per app; running a command before this throws
```

`audit` is an `AuditPort` implemented by `module-audit` (T-006); it receives each entry **with the command's
transaction** so the audit row commits with the handler. Optional: `clock`, `tracer`, `metrics`, `logger`, `db`,
`maxRetries`, `idempotencyTtlMs`.

## Observability

One span per execution named `command.name` with `command.name`, `actor.type`, `outcome`
(`ok` | `domain_error` | `error`) and `error.code`. **Never input values and never the actor id.**

## Testing (`@igs/kernel/testing`, test-only — A8)

Importable only from test code (`*.test.ts`, `test/`, `vitest.config.ts`); enforced by the boundaries rules.

```ts
import { actors, configureKernelForTests, resetKernelForTests } from "@igs/kernel/testing";
import { createIsolatedDatabase } from "@igs/db/testing";

const iso = await createIsolatedDatabase();
const kernel = configureKernelForTests({ db: iso.db });   // fake clock, in-memory audit, captured spans/metrics
await approveReview({ orderId: "o-1" }, actors.user({ roles: ["pharmacist"] }));
expect(kernel.inMemoryAudit.entries[0]?.action).toBe("pharmacy.review.decided");
```

`actors.user/anonymous/system/webhook`, `fakeClock()`, `InMemoryAudit` (does not roll back — pass a DB-backed
`AuditPort` to test atomicity, see `packages/kernel/test/command.test.ts`), `resetKernelForTests()`.
See `docs/06-engineering/migrations.md` for the real-Postgres harness.

## Audit: buffered, flushed right before commit (T-006b, D-026)

`ctx.audit.record(entry)` does **not** write anything while the handler runs: it validates the entry (`AuditPort.validate`, if the port has one: synchronous, no database), counts it for the `kernel.audit_missing` guard and **buffers** it. After the handler, the audit guard and the output parse, the kernel flushes the buffer to `AuditPort.record(entry, { actor, tx, at, origin })` **in call order, inside the transaction, right before commit**. So the audit chain's head-row lock is held only for the flush, and a failing flush (or any later failure) rolls back the handler's writes, the audit rows and the idempotency key together.

- The buffer is **per attempt**: a 40001/40P01 retry starts with an empty one.
- Nested `ctx.run` commands append to the **same** buffer (entries keep call order across commands) and are flushed once, at the end of the outermost execution. Each command still has its own `audit_missing` guard.
- `validate` makes an unregistered action or invalid `data` fail **in the handler's stack**; the flush validates again (cheap, covers custom ports).
- **`CallOptions.origin`** (`{ ip?, userAgent? }`) is set only by the edge adapter. The kernel forwards it to the port, which hashes it (keyed). It is **never** in `Ctx`, spans, logs or the idempotency request hash, so handlers can't leak it.
- Wiring: each app's composition root calls the auditing modules' `registerAuditActions()` and then `configureKernel({ audit: createAuditPort(...) })`. The worker holds no HMAC key (its actors never have an `origin`); web / platform parse `auditEnv` inside `ensureKernelConfigured()`.
- Modules that register background jobs call `getKernelRuntime()` (`db`, `metrics`, `logger`, `now`) **inside their own `register…Jobs(boss)`**, so app code never holds a database handle (D-015). Apps must not call it; it is not for request handling.

## Events and the outbox

An owning module declares its events and registers them at start-up:

```ts
import { defineEvent, registerEvents } from "@igs/kernel";

// topic = <module>.<entity>.<past_tense>; bump the version on incompatible payload changes
export const ReviewApproved = defineEvent("pharmacy.review.approved", 1, z.object({ reviewId: z.string() }));
registerEvents(ReviewApproved);   // idempotent; the kernel only holds the registry mechanism

// inside a handler: inserted into system.outbox in the command's transaction
await ctx.outbox.publish(ReviewApproved, { reviewId });
```

- The payload is validated against the event schema (`kernel.invalid_event_payload`), the event must be registered (`kernel.event_not_registered`). **Payloads carry identifiers and status only — never personal or health data (D-020, A5)**; subscribers load what they need. `system.outbox.schema_version` records the event version.
- `system.outbox`: `id` (UUIDv7), `topic`, `schema_version`, `payload`, `created_at`, `published_at`, `attempts`, `last_error`, `next_attempt_at`, `dead_at`. Partial index on rows still to be delivered. `last_error` holds only the error class (and SQL code), never a message that could echo data.

### The relay (`startOutboxRelay`)

The worker calls `startOutboxRelay({ queue: boss })` (the worker imports only `@igs/kernel` for this; D-015/A7). Every `intervalMs` (default 1 s) it, **in one transaction**:

1. selects due rows `FOR UPDATE SKIP LOCKED` (several relays can run; none handles the same row);
2. per row, inside a savepoint: `boss.send(topic, envelope, { singletonKey: outbox.id, db: pgBossExecutor(tx) })` and sets `published_at`. Because pg-boss writes through *our* transaction, **the job and `published_at` commit or roll back together** (tested). `singletonKey` is defence in depth;
3. on failure: `attempts + 1`, `last_error`, `next_attempt_at = now + base·2^(attempts-1)` (cap 5 min, +≤20 % jitter); after `maxAttempts` (default 10) the row is **dead-lettered** (`dead_at`), logged as `kernel.outbox.dead` and counted.

The job `data` is `{ eventId, topic, schemaVersion, payload }`; the pg-boss queue is named after the topic (created on first use). Metrics: `kernel.outbox.published|failed|dead` counters and the gauge `kernel.outbox.lag_seconds` (age of the oldest undelivered event — the ops alert fires above 5 minutes). Delivery to subscribers is **at-least-once**, and **ordering across events is not guaranteed** (K5c): consumers must be order-independent or compare the aggregate `version`.

### Subscribers: `handleOnce`

```ts
boss.work("pharmacy.review.approved", async ([job]) => {
  const { eventId, payload } = job.data as OutboxEnvelope;
  await handleOnce(eventId, "notifications.review-approved", async (tx) => { /* writes via tx; no external I/O */ });
});
```

`handleOnce(eventId, subscriber, fn)` claims `event:{id}:{subscriber}` in `system.idempotency_keys` and runs `fn` in the **same** transaction: duplicates return `undefined`, a failing `fn` rolls the claim back so the retry runs. Sending the e-mail itself is a *separate* job enqueued through the outbox, never a call inside `fn` (D-019).

### Housekeeping (`purgeExpired`, K5)

`purgeExpired()` deletes outbox rows published more than 7 days ago and expired `system.idempotency_keys` (command responses and `handleOnce` claims). Dead-lettered and unpublished outbox rows are kept. The worker schedules it daily (03:17 Europe/Brussels) as the pg-boss job `kernel.maintenance.purge`; it needs only DML rights. Counters are emitted by value: `metrics.increment(name, labels, value)`; labels must stay low-cardinality (never a count or an id).

### pg-boss's own schema (A6, D-021)

pg-boss manages the `pgboss` schema itself. The worker passes `migrate: false` when `NODE_ENV=production` (it has no DDL rights there) and `migrate: true` otherwise. The production install/upgrade is an explicit step of the migration job (B-08); see `migrations.md`.

### Per-process environment

`@igs/config` exposes composable schemas (`dbEnv`, `authEnv`, `appEnv`, `cryptoEnv`, `observabilityEnv`, `workerEnv`) and `parseEnvFor(schema)`. The worker parses `workerEnv` and does not need `AUTH_SECRET`/`AUTH_URL`; `web`/`platform` keep `getEnv()` (the full set).
