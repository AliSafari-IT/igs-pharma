import { uuidv7 } from "uuidv7";

/**
 * Time-ordered UUIDv7 primary key, generated application-side (D-003).
 * Pure helper: safe to import from schema files loaded by drizzle-kit (no env, no server-only).
 */
export function newId(): string {
  return uuidv7();
}
