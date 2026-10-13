// The migrations journal must be applicable (igs-pharma#77): Drizzle skips an entry whose `when` is
// not newer than the last applied one, so such a migration would silently never run.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { checkJournal } from "../src/journal";

const committed = fileURLToPath(new URL("../drizzle", import.meta.url));
const scratch: string[] = [];

/** A copy of the committed folder to break on purpose. */
function copy(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "igs-journal-"));
  fs.cpSync(committed, dir, { recursive: true });
  scratch.push(dir);
  return dir;
}

type Journal = { entries: { idx: number; tag: string; when: number }[] };
const edit = (dir: string, change: (journal: Journal) => void) => {
  const file = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(file, "utf8")) as Journal;
  change(journal);
  fs.writeFileSync(file, JSON.stringify(journal));
};

afterEach(() => {
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("checkJournal", () => {
  it("passes on the committed migrations", () => {
    expect(checkJournal(committed)).toEqual([]);
  });

  it("flags an entry whose `when` is not newer than its predecessor's (it would never run)", () => {
    const dir = copy();
    edit(dir, (j) => {
      const last = j.entries.at(-1);
      const before = j.entries.at(-2);
      if (last && before) last.when = before.when; // equal is not enough
    });
    expect(checkJournal(dir).join("\n")).toMatch(/is not greater than .* Drizzle would skip it/);
    edit(dir, (j) => {
      const last = j.entries.at(-1);
      const before = j.entries.at(-2);
      if (last && before) last.when = before.when - 1;
    });
    expect(checkJournal(dir)).toHaveLength(1);
  });

  it("flags a missing SQL file, a missing snapshot and an orphan SQL file", () => {
    const dir = copy();
    fs.rmSync(path.join(dir, "0025_rbac_seed_storefront.sql"));
    fs.rmSync(path.join(dir, "meta", "0026_snapshot.json"));
    fs.writeFileSync(path.join(dir, "0099_orphan.sql"), "SELECT 1;");
    const problems = checkJournal(dir).join("\n");
    expect(problems).toMatch(/0025_rbac_seed_storefront\.sql is missing/);
    expect(problems).toMatch(/meta\/0026_snapshot\.json is missing/);
    expect(problems).toMatch(/0099_orphan\.sql has no journal entry/);
  });

  it("flags a gap in idx and an unreadable journal", () => {
    const dir = copy();
    edit(dir, (j) => {
      const entry = j.entries[3];
      if (entry) entry.idx = 40;
    });
    expect(checkJournal(dir).join("\n")).toMatch(/idx 40 is not 3/);
    fs.rmSync(path.join(dir, "meta", "_journal.json"));
    expect(checkJournal(dir)[0]).toMatch(/cannot read/);
  });
});
