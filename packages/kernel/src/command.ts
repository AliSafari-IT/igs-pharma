import { AsyncLocalStorage } from "node:async_hooks";

import { type Permission, hasPermission } from "@igs/auth/permissions";
import { newId } from "@igs/db/ids";
import { eq, lte } from "drizzle-orm";
import type { z } from "zod";

import type { Actor } from "./actor";
import { requestHash } from "./canonical";
import { type AuditEntry, type KernelConfig, type Tx, getKernelConfig } from "./config";
import {
  type FieldIssue,
  conflict,
  forbidden,
  invariant,
  isDomainError,
  validationFailed,
} from "./errors";
import { type EventDef, requireRegistered } from "./events";
import { idempotencyKeys, outbox } from "./schema";

// ── public types ───────────────────────────────────────────────────────────────────────────────

export type PermissionSpec = Permission | "public";

export interface Ctx {
  /** The single transaction of this execution. */
  readonly tx: Tx;
  /** Explicit actor — never read from ambient state. */
  readonly actor: Actor;
  /** Injected clock value for this attempt. */
  readonly now: Date;
  /** Written inside `tx`; commits or rolls back with the handler. */
  readonly audit: { record(entry: AuditEntry): Promise<void> };
  /**
   * Transactional outbox: the event row is inserted in `tx`, so it commits or rolls back with the
   * handler. The payload is validated against the event schema; identifiers and status only (D-020).
   */
  readonly outbox: { publish<T>(event: EventDef<T>, payload: T): Promise<void> };
  /** Resource-level checks inside a handler (the command-level permission is already enforced). */
  can(permission: Permission): boolean;
  /**
   * Run another command **in this transaction** (authorization and audit are enforced per command).
   * Calling another command's function directly inside a handler is an error (`kernel.nested_command`).
   */
  run<I, O>(cmd: Command<I, O>, rawInput: unknown): Promise<O>;
}

export interface QueryCtx {
  readonly tx: Tx;
  readonly actor: Actor;
  readonly now: Date;
  can(permission: Permission): boolean;
}

export interface CommandSpec<I, O> {
  /** Stable name: `<module>.<entity>.<verb>`; also the span name. */
  readonly name: string;
  readonly input: z.ZodType<I, unknown>;
  /**
   * Parsed (so unknown keys are stripped) before the result is returned. **Required for idempotent
   * commands**, whose response is stored in plaintext: identifiers and status only — never PII or
   * health data (D-020).
   */
  readonly output?: z.ZodType<O, unknown>;
  /** `"public"` is allowed only for operations listed in docs/06-engineering/kernel.md. */
  readonly permission: PermissionSpec;
  /** Default `"required"`: the handler must record an audit entry or the execution rolls back. */
  readonly audit?: "required" | "none";
  /** D-019: no external I/O (HTTP, PSP, e-mail, file storage) in here — side effects leave via the outbox. */
  readonly handler: (args: { input: I; ctx: Ctx }) => Promise<O>;
}

export interface CallOptions {
  /** Replays the stored response for the same (command, actor, key) within the TTL. */
  readonly idempotencyKey?: string;
}

export type Command<I, O> = ((
  rawInput: unknown,
  actor: Actor,
  options?: CallOptions,
) => Promise<O>) & { readonly spec: CommandSpec<I, O> };

export interface QuerySpec<I, O> {
  readonly name: string;
  readonly input: z.ZodType<I, unknown>;
  readonly permission: PermissionSpec;
  /** Reserved for access auditing of health data; passing `true` throws until implemented. */
  readonly auditRead?: false;
  readonly handler: (args: { input: I; ctx: QueryCtx }) => Promise<O>;
}

export type Query<I, O> = ((rawInput: unknown, actor: Actor) => Promise<O>) & {
  readonly spec: QuerySpec<I, O>;
};

// ── internals ──────────────────────────────────────────────────────────────────────────────────

/** Set while a kernel transaction is running: lets us reject direct nested command calls. */
const active = new AsyncLocalStorage<{ readonly name: string }>();

const RETRYABLE_PG_CODES = new Set(["40001", "40P01"]); // serialization failure, deadlock detected
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

function pgErrorCode(error: unknown): string | undefined {
  for (let e: unknown = error, depth = 0; e && depth < 4; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function parseInput<I>(schema: z.ZodType<I, unknown>, raw: unknown): I {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const fields: FieldIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    code: issue.code,
  }));
  throw validationFailed("kernel.validation_failed", fields);
}

function canDo(actor: Actor, permission: Permission): boolean {
  // anonymous actors never carry roles, whatever the caller passed
  return hasPermission(actor.type === "anonymous" ? [] : actor.roles, permission);
}

function authorize(permission: PermissionSpec, actor: Actor): void {
  if (permission === "public") return;
  if (!canDo(actor, permission)) throw forbidden("kernel.forbidden");
}

function guardNotNested(name: string): void {
  const outer = active.getStore();
  if (outer) {
    throw invariant("kernel.nested_command", { command: name, within: outer.name });
  }
}

/** One span per execution. Attributes never include input values or the actor id (PII). */
async function traced<T>(
  config: KernelConfig,
  name: string,
  actor: Actor,
  fn: () => Promise<T>,
): Promise<T> {
  const span = config.tracer.startSpan(name);
  span.setAttribute("command.name", name);
  span.setAttribute("actor.type", actor.type);
  try {
    const result = await fn();
    span.setAttribute("outcome", "ok");
    return result;
  } catch (error) {
    span.setAttribute("outcome", isDomainError(error) ? "domain_error" : "error");
    span.setAttribute("error.code", isDomainError(error) ? error.code : "kernel.internal");
    throw error;
  } finally {
    span.end();
  }
}

/** Runs `fn` in one transaction, retrying the WHOLE execution on 40001/40P01 (safe because of D-019). */
async function inTransaction<T>(
  config: KernelConfig,
  name: string,
  fn: (tx: Tx) => Promise<T>,
  txConfig: { isolationLevel: "read committed"; accessMode?: "read only" | "read write" },
): Promise<T> {
  const db = config.db();
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction((tx) => active.run({ name }, () => fn(tx)), txConfig);
    } catch (error) {
      const code = pgErrorCode(error);
      if (code && RETRYABLE_PG_CODES.has(code) && attempt < config.maxRetries) {
        config.metrics.increment("kernel.tx.retry", { command: name, code });
        await sleep(20 * 2 ** attempt + Math.random() * 20); // exponential backoff with jitter
        continue;
      }
      throw error;
    }
  }
}

function buildCtx(
  config: KernelConfig,
  tx: Tx,
  actor: Actor,
  now: Date,
  audited: { n: number },
): Ctx {
  const ctx: Ctx = {
    tx,
    actor,
    now,
    audit: {
      async record(entry) {
        audited.n++;
        await config.audit.record(entry, { actor, tx, at: now });
      },
    },
    outbox: {
      async publish(event, payload) {
        requireRegistered(event);
        const parsed = event.schema.safeParse(payload);
        if (!parsed.success) {
          throw invariant("kernel.invalid_event_payload", { topic: event.topic });
        }
        await tx.insert(outbox).values({
          id: newId(),
          topic: event.topic,
          schemaVersion: event.version,
          payload: parsed.data,
          createdAt: now,
          nextAttemptAt: now,
        });
      },
    },
    can: (permission) => canDo(actor, permission),
    run: (cmd, rawInput) => runJoined(config, cmd, rawInput, tx, actor, now),
  };
  return ctx;
}

/** Handler + audit guard + output parse, inside an already-open transaction. */
async function runHandler<I, O>(
  config: KernelConfig,
  spec: CommandSpec<I, O>,
  input: I,
  tx: Tx,
  actor: Actor,
  now: Date,
): Promise<O> {
  const audited = { n: 0 };
  const output = await spec.handler({ input, ctx: buildCtx(config, tx, actor, now, audited) });
  if ((spec.audit ?? "required") === "required" && audited.n === 0) {
    throw invariant("kernel.audit_missing", { command: spec.name });
  }
  return spec.output ? spec.output.parse(output) : output;
}

/** `ctx.run`: another command joining the caller's transaction. */
function runJoined<I, O>(
  config: KernelConfig,
  cmd: Command<I, O>,
  rawInput: unknown,
  tx: Tx,
  actor: Actor,
  now: Date,
): Promise<O> {
  const spec = cmd.spec;
  return traced(config, spec.name, actor, async () => {
    authorize(spec.permission, actor);
    const input = parseInput(spec.input, rawInput);
    return runHandler(config, spec, input, tx, actor, now);
  });
}

type Claim<O> = { replayed: false } | { replayed: true; value: O };

/**
 * Claims the idempotency key inside the command's transaction. A concurrent duplicate blocks on the
 * unique row until the first transaction ends, then reads its stored response.
 */
async function claim<O>(
  config: KernelConfig,
  spec: CommandSpec<unknown, O>,
  tx: Tx,
  key: string,
  hash: string,
  now: Date,
): Promise<Claim<O>> {
  const expiresAt = new Date(now.getTime() + config.idempotencyTtlMs);
  const claimed = await tx
    .insert(idempotencyKeys)
    .values({ key, createdAt: now, expiresAt, requestHash: hash })
    .onConflictDoUpdate({
      target: idempotencyKeys.key,
      // an EXPIRED row is reclaimed (acts as a fresh execution); a live one is left alone
      set: { createdAt: now, expiresAt, response: null, requestHash: hash },
      setWhere: lte(idempotencyKeys.expiresAt, now),
    })
    .returning({ key: idempotencyKeys.key });
  if (claimed.length > 0) return { replayed: false };

  const [existing] = await tx.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key));
  if (existing?.requestHash && existing.requestHash !== hash) {
    throw conflict("kernel.idempotency_key_reused", { command: spec.name });
  }
  if (!existing?.response) {
    throw conflict("kernel.idempotency_in_progress", { command: spec.name });
  }
  const output = spec.output as z.ZodType<O, unknown>;
  return { replayed: true, value: output.parse(JSON.parse(existing.response)) };
}

// ── command() ──────────────────────────────────────────────────────────────────────────────────

/**
 * Defines a command: authorize/validate → ONE transaction (handler, audit, later outbox) → audit
 * guard → commit. Order of the pre-transaction stage: authorize → parse input (K1); both happen before
 * the transaction opens, so a rejected call performs no database work.
 */
export function command<I, O>(spec: CommandSpec<I, O>): Command<I, O> {
  const run = async (rawInput: unknown, actor: Actor, options: CallOptions = {}): Promise<O> => {
    const config = getKernelConfig();
    guardNotNested(spec.name);
    return traced(config, spec.name, actor, async () => {
      // authorize BEFORE validating: an unauthorised caller learns nothing about the input schema (K1)
      authorize(spec.permission, actor);
      const input = parseInput(spec.input, rawInput);

      const key = options.idempotencyKey;
      if (key !== undefined) {
        if (!spec.output) throw invariant("kernel.output_schema_required", { command: spec.name });
        if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
          throw validationFailed("kernel.invalid_idempotency_key", [
            { path: "idempotencyKey", code: "invalid_length" },
          ]);
        }
      }
      const storageKey = key === undefined ? undefined : `${spec.name}:${actor.id}:${key}`;

      return inTransaction(
        config,
        spec.name,
        async (tx) => {
          const now = config.clock();
          if (storageKey !== undefined) {
            const claimed = await claim(
              config,
              spec as CommandSpec<unknown, O>,
              tx,
              storageKey,
              requestHash(input),
              now,
            );
            if (claimed.replayed) return claimed.value;
          }
          const output = await runHandler(config, spec, input, tx, actor, now);
          if (storageKey !== undefined) {
            const response = JSON.stringify(output);
            if (response === undefined) {
              // would leave the key "in progress" forever (K4)
              throw invariant("kernel.idempotent_output_undefined", { command: spec.name });
            }
            await tx
              .update(idempotencyKeys)
              .set({ response })
              .where(eq(idempotencyKeys.key, storageKey));
          }
          return output;
        },
        { isolationLevel: "read committed" },
      );
    });
  };
  return Object.assign(run, { spec });
}

// ── query() ────────────────────────────────────────────────────────────────────────────────────

/** Read-only counterpart: authorization-checked, runs in a READ ONLY transaction, no audit by default. */
export function query<I, O>(spec: QuerySpec<I, O>): Query<I, O> {
  if ((spec as { auditRead?: unknown }).auditRead) {
    throw new Error("kernel.audit_read_not_implemented: `auditRead` is reserved");
  }
  const run = async (rawInput: unknown, actor: Actor): Promise<O> => {
    const config = getKernelConfig();
    guardNotNested(spec.name);
    return traced(config, spec.name, actor, async () => {
      authorize(spec.permission, actor);
      const input = parseInput(spec.input, rawInput);
      return inTransaction(
        config,
        spec.name,
        (tx) => {
          const ctx: QueryCtx = { tx, actor, now: config.clock(), can: (p) => canDo(actor, p) };
          return spec.handler({ input, ctx });
        },
        { isolationLevel: "read committed", accessMode: "read only" },
      );
    });
  };
  return Object.assign(run, { spec });
}
