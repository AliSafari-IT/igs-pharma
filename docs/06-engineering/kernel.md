# Kernel (`@igs/kernel`)

Every state change goes through a **command**; every read through a **query**. Server Actions,
route handlers and jobs call them — never tables (D-005, D-015). The kernel is infrastructure: it
imports only `db`, `auth`, `observability` and `config`, **never a module** (D-004). Modules
implement kernel *ports* (e.g. `AuditPort`) and each app wires them in.

## Execution order (the invariant)

```
span start → parse input (Zod) → authorize → open ONE transaction
           → idempotency check → handler → audit guard → output parse → commit → span end
```

- Parsing and authorization happen **before the transaction opens**: a rejected call does no database work.
- Everything in the handler — your writes, the audit entry, (from T-005b) the outbox event — commits or rolls back **together**.
- Any throw inside the transaction (a `DomainError` or anything else) rolls it back and is re-thrown.
- Default isolation `READ COMMITTED`; use optimistic `version` checks in handlers. On `40001` (serialization failure) or `40P01` (deadlock) the kernel **retries the whole execution** (default: up to 3 retries, exponential backoff with jitter) and records the metric `kernel.tx.retry`. Retrying is safe only because of the next rule.

## Rules for handlers

1. **No external I/O inside a handler (D-019)**: no HTTP, PSP, e-mail or file-storage calls. Side effects leave through the outbox (T-005b), which is what makes retries and rollbacks safe.
2. **No PII or health data** in audit `data`, idempotent outputs, outbox payloads, spans or logs (D-020). Carry identifiers and status.
3. **Don't call another command's function directly** inside a handler: it throws `kernel.nested_command`. Use `ctx.run(otherCommand, input)`, which joins your transaction (authorization and audit are enforced per command). Queries can't be called from inside a handler either; read through `ctx.tx`.
4. Use `ctx.can(permission)` for resource-level checks (ownership, location). The command-level permission is already enforced.

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
status only** (the schema strips everything else). **Known limitation:** reusing a key with a *different*
input replays the first response — callers must generate a fresh key per logical request.

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

## Not yet (T-005b)

`system.outbox`, `defineEvent` / `ctx.outbox.publish`, the pg-boss relay in the worker and `handleOnce`.
