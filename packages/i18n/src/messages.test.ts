import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { locales } from "./routing";

const messagesDir = join(import.meta.dirname, "..", "messages");

function flatten(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k),
  );
}

function keysFor(locale: string): string[] {
  const raw = readFileSync(join(messagesDir, `${locale}.json`), "utf8");
  return flatten(JSON.parse(raw)).sort();
}

describe("locale message files", () => {
  const reference = keysFor("nl");

  it("has a non-empty reference locale", () => {
    expect(reference.length).toBeGreaterThan(0);
  });

  for (const locale of locales) {
    it(`${locale}.json has exactly the same keys as nl.json`, () => {
      expect(keysFor(locale)).toEqual(reference);
    });
  }
});
