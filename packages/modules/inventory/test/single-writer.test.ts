// D-037 (igs-pharma#83): stock is written through ONE function. The database guard is the backstop;
// this test keeps the code honest: no source file other than the module's ledger writes
// `inventory.stock_movements`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

/** The only source file allowed to write the ledger. */
const ALLOWED = new Set(["packages/modules/inventory/src/ledger.ts"]);

const WRITES = [
  /\.insert\(\s*(?:\w+\.)*stockMovements\b/, // drizzle
  /INSERT\s+INTO\s+"?inventory"?\."?stock_movements/i, // raw SQL
  /COPY\s+"?inventory"?\."?stock_movements/i,
  /\.into\(\s*stockMovements/, // any other query builder
];

function sources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      ["node_modules", ".next", "dist", ".turbo", "drizzle", "test", "tests"].includes(entry.name)
    )
      continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sources(full));
    else if (/\.(ts|tsx|mts|mjs|js|sql)$/.test(entry.name) && !/\.test\./.test(entry.name))
      found.push(full);
  }
  return found;
}

describe("single stock writer", () => {
  it("only inventory/src/ledger.ts writes inventory.stock_movements", () => {
    const offenders: string[] = [];
    for (const top of ["apps", "packages"]) {
      for (const file of sources(path.join(root, top))) {
        const relative = path.relative(root, file).split(path.sep).join("/");
        if (ALLOWED.has(relative)) continue;
        const content = fs.readFileSync(file, "utf8");
        if (WRITES.some((pattern) => pattern.test(content))) offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the scan sees the writer (so it cannot pass by looking at nothing)", () => {
    for (const relative of ALLOWED) {
      const content = fs.readFileSync(path.join(root, relative), "utf8");
      expect(WRITES.some((pattern) => pattern.test(content))).toBe(true);
    }
  });
});
