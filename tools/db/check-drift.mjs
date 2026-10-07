/**
 * Fails when the Drizzle schema changed without a committed migration.
 *
 * Runs `drizzle-kit generate` into a temporary copy of packages/db/drizzle (never touching the
 * committed folder or the working tree) and fails if it emits a new migration file.
 * Needs no database connection; DATABASE_URL only has to be a valid URL for the config.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dbDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "packages",
  "db",
);
const committed = path.join(dbDir, "drizzle");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "igs-drift-"));
const out = path.join(tmp, "drizzle");
fs.cpSync(committed, out, { recursive: true });

const sqlFiles = (dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
const before = sqlFiles(out);

const run = spawnSync("pnpm", ["exec", "drizzle-kit", "generate"], {
  cwd: dbDir,
  env: {
    DATABASE_URL: "postgresql://drift:drift@localhost:5432/drift",
    ...process.env,
    DRIZZLE_OUT: path.relative(dbDir, out),
  },
  encoding: "utf8",
});

const added = fs.existsSync(out) ? sqlFiles(out).filter((f) => !before.includes(f)) : [];
const generated = added
  .map((f) => `--- ${f}\n${fs.readFileSync(path.join(out, f), "utf8")}`)
  .join("\n");
fs.rmSync(tmp, { recursive: true, force: true });

// drizzle-kit can print an error and still exit 0, so require one of its two known outcomes
const recognised = /No schema changes|Your SQL migration file/.test(run.stdout);
if (run.status !== 0 || !recognised) {
  process.stderr.write(`${run.stdout}${run.stderr}\ndrizzle-kit generate failed\n`);
  process.exit(run.status ?? 1);
}
if (added.length > 0) {
  process.stderr.write(
    `Schema drift: the Drizzle schema has changes with no committed migration.\nRun \`pnpm db:generate\`, review the SQL and commit it. It would generate:\n\n${generated}\n`,
  );
  process.exit(1);
}
process.stdout.write("No schema drift: committed migrations match the Drizzle schema.\n");
