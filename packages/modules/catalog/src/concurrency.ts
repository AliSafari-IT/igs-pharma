import { conflict } from "@igs/kernel";

/**
 * Optimistic concurrency (igs-pharma#80). A catalog row carries a `version` that every write bumps by
 * one; an edit carries the version its form loaded. Called right after the row was read under
 * `FOR UPDATE`, before anything is written: a stale form loses nothing and overwrites nothing.
 */
export function requireVersion(current: number, expected: number): void {
  if (current !== expected) throw conflict("catalog.stale_version", { expected, current });
}

/** A unique violation (`23505`) on `constraint`, as raised by postgres.js. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const e = error as { code?: string; constraint_name?: string } | null;
  return e?.code === "23505" && e.constraint_name === constraint;
}
