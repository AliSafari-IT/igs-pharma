import { createHash } from "node:crypto";

/**
 * Deterministic JSON for hashing parsed command input (idempotency request hash, K4):
 * object keys sorted, no whitespace, `undefined` keys dropped, `Date` as UTC ISO-8601 with
 * milliseconds, finite numbers only, `bigint` as a tagged string so `1` and `1n` differ.
 * (The audit chain uses its own, stricter canonical form: T-006.)
 */
export function canonicalJson(value: unknown): string {
  return encode(value, "$");
}

function encode(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value))
        throw new TypeError(`canonicalJson: non-finite number at ${path}`);
      return JSON.stringify(value);
    case "bigint":
      return JSON.stringify(`${value}n`);
    case "object": {
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime()))
          throw new TypeError(`canonicalJson: invalid Date at ${path}`);
        return JSON.stringify(value.toISOString());
      }
      if (Array.isArray(value)) {
        return `[${value.map((item, i) => encode(item === undefined ? null : item, `${path}[${i}]`)).join(",")}]`;
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${encode(v, `${path}.${k}`)}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported ${typeof value} at ${path}`);
  }
}

/** `sha256(canonicalJson(value))`, hex. */
export function requestHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
