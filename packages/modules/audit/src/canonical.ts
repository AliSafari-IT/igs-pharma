/**
 * Canonical JSON for the audit hash chain (D-028). Specified in docs/03-architecture/audit-log.md
 * and pinned by golden vectors in `test/canonical.test.ts`; any reimplementation must reproduce them.
 *
 * - UTF-8, no whitespace; object keys sorted by UTF-16 code unit;
 * - strings escaped exactly as `JSON.stringify`;
 * - numbers: **safe integers only** — floats, `NaN` and `Infinity` are rejected;
 * - `null` kept; object keys whose value is `undefined` dropped; `undefined` inside arrays rejected;
 * - no `Date`/`bigint`: callers format timestamps (see `canonicalEvent`).
 */
export type Canonical =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly Canonical[]
  | { readonly [key: string]: Canonical };

export function canonicalJson(value: Canonical): string {
  return encode(value, "$");
}

function encode(value: Canonical, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new TypeError(`canonicalJson: only safe integers are allowed (at ${path})`);
      }
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item, i) => encode(item as Canonical, `${path}[${i}]`)).join(",")}]`;
      }
      const entries = Object.entries(value as { readonly [key: string]: Canonical })
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${encode(v, `${path}.${k}`)}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported value (at ${path})`);
  }
}
