import { logger as defaultLogger } from "@igs/observability/logger";

import { peekKernelConfig } from "./config";

/**
 * Typed domain errors with stable `code`s (D-006). The kernel contains **no user-facing text**:
 * the edge maps `code` to a translated message (next-intl). Codes are `<module>.<reason>`; the
 * kernel's own are `kernel.*`.
 */
export type DomainErrorKind =
  | "Forbidden"
  | "NotFound"
  | "Conflict"
  | "ValidationFailed"
  | "InvariantViolation";

/** Non-PII structured context only (identifiers, counters, flags) — it can end up in logs. */
export type ErrorDetails = Readonly<Record<string, string | number | boolean | null>>;

/** A failed input field: where, and a machine code. Never the offending value (PII). */
export interface FieldIssue {
  readonly path: string;
  readonly code: string;
}

export interface DomainErrorOptions {
  readonly details?: ErrorDetails | undefined;
  readonly fields?: readonly FieldIssue[] | undefined;
  readonly cause?: unknown;
}

export class DomainError extends Error {
  readonly kind: DomainErrorKind;
  readonly code: string;
  readonly details: ErrorDetails | undefined;
  readonly fields: readonly FieldIssue[] | undefined;

  constructor(kind: DomainErrorKind, code: string, options: DomainErrorOptions = {}) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DomainError";
    this.kind = kind;
    this.code = code;
    this.details = options.details;
    this.fields = options.fields;
  }
}

export const isDomainError = (error: unknown): error is DomainError => error instanceof DomainError;

export const forbidden = (code: string, details?: ErrorDetails) =>
  new DomainError("Forbidden", code, { details });
export const notFound = (code: string, details?: ErrorDetails) =>
  new DomainError("NotFound", code, { details });
export const conflict = (code: string, details?: ErrorDetails) =>
  new DomainError("Conflict", code, { details });
export const validationFailed = (code: string, fields: readonly FieldIssue[]) =>
  new DomainError("ValidationFailed", code, { fields });
export const invariant = (code: string, details?: ErrorDetails) =>
  new DomainError("InvariantViolation", code, { details });

export interface ErrorResponse {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetails;
  readonly fields?: readonly FieldIssue[];
}

const STATUS: Readonly<Record<DomainErrorKind, number>> = {
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  ValidationFailed: 422,
  // "should never happen" (a bug or corrupted state), not a client error
  InvariantViolation: 500,
};

/**
 * Edge helper: maps any thrown value to `{ status, code, details?, fields? }` — **no text**.
 * Apps translate `code` with next-intl. Unknown errors become `500 kernel.internal`; the original
 * is logged (name, message, stack — never command input).
 */
export function toErrorResponse(error: unknown): ErrorResponse {
  if (isDomainError(error)) {
    return {
      status: STATUS[error.kind],
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
      ...(error.fields ? { fields: error.fields } : {}),
    };
  }
  const original =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: "NonError", message: String(error) };
  (peekKernelConfig()?.logger ?? defaultLogger).error(
    { err: original },
    "Unhandled error mapped to kernel.internal",
  );
  return { status: 500, code: "kernel.internal" };
}
