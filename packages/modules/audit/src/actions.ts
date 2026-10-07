import { invariant } from "@igs/kernel";
import { z } from "zod";

/** `<domain>.<noun>.<verb>` e.g. `pharmacy.review.decided`. */
export const ACTION_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export type AuditDataValue = string | number | boolean | null;
export type AuditDataShape = Readonly<Record<string, AuditDataValue>>;

const registry = new Map<string, z.ZodType<Record<string, unknown>>>();

/**
 * Declares the allow-listed `data` shape of an audit action (D-028). The schema is made strict, so
 * unknown keys are rejected rather than silently stored. Values may only be strings, integers,
 * booleans or null — identifiers and status, never PII, health data, secrets or free text.
 * Owning modules call this at start-up; re-registering the same action is an error.
 */
export function registerAuditAction(action: string, data: z.ZodObject<z.ZodRawShape>): void {
  if (!ACTION_PATTERN.test(action)) {
    throw new Error(`audit.invalid_action: "${action}" must match <domain>.<noun>.<verb>`);
  }
  if (registry.has(action)) throw new Error(`audit.action_already_registered: "${action}"`);
  registry.set(action, z.strictObject(data.shape));
}

/** Test seam. */
export function resetAuditActions(): void {
  registry.clear();
}

/** Validates `action` and `data`; returns the parsed data. Unknown actions fail closed. */
export function parseAuditData(action: string, data: unknown): Record<string, AuditDataValue> {
  if (!ACTION_PATTERN.test(action)) throw invariant("audit.invalid_action");
  const schema = registry.get(action);
  if (!schema) throw invariant("audit.unknown_action", { action });
  const parsed = schema.safeParse(data ?? {});
  if (!parsed.success) throw invariant("audit.invalid_data", { action });
  for (const value of Object.values(parsed.data)) {
    const ok =
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isSafeInteger(value));
    if (!ok) throw invariant("audit.invalid_data", { action });
  }
  return parsed.data as Record<string, AuditDataValue>;
}
