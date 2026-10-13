/**
 * Renders a grants migration from the manifest (igs-pharma#66):
 *
 *   pnpm db:grants:generate          # rewrites drizzle/0026_runtime_grants.sql (keeps its header)
 *   pnpm db:grants:generate 27       # a later migration: the GRANTs of the entries with `since: 27`
 *
 * For a later migration, create the empty file first (`drizzle-kit generate --custom --name=…`).
 * `test/grants-sql.test.ts` fails when a committed grants migration differs from this output.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { APP_SCHEMAS, GRANTS_MIGRATION, renderGrantsSql } from "../src/grants";
import { splitHeader } from "../src/grants/migration-file";

const migration = Number(process.argv[2] ?? GRANTS_MIGRATION);
if (!Number.isInteger(migration) || migration < GRANTS_MIGRATION) {
  process.stderr.write(`usage: db:grants:generate [migration number >= ${GRANTS_MIGRATION}]\n`);
  process.exit(1);
}

const folder = fileURLToPath(new URL("../drizzle", import.meta.url));
const prefix = String(migration).padStart(4, "0");
const file = fs
  .readdirSync(folder)
  .find((name) => name.startsWith(`${prefix}_`) && name.endsWith(".sql"));
if (!file) {
  process.stderr.write(
    `no drizzle/${prefix}_*.sql: create it with drizzle-kit generate --custom first\n`,
  );
  process.exit(1);
}

const target = path.join(folder, file);
const { header } = splitHeader(fs.readFileSync(target, "utf8"));
fs.writeFileSync(target, `${header}\n\n${renderGrantsSql(APP_SCHEMAS, { migration })}\n`);
process.stdout.write(`wrote drizzle/${file}\n`);
