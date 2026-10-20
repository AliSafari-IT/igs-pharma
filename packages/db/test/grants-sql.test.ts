// The committed grants migrations are exactly what the manifest renders (igs-pharma#66): a
// privilege-neutral edit of the SQL, or a GRANT later cancelled by a REVOKE, fails here.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  APP_SCHEMAS,
  GRANTS_MIGRATION,
  renderGrantsSql,
  renderPgbossGrantsScript,
  renderPgbossGrantsSql,
} from "../src/grants";
import { splitHeader } from "../src/grants/migration-file";

const folder = fileURLToPath(new URL("../drizzle", import.meta.url));
const fileOf = (migration: number) =>
  fs
    .readdirSync(folder)
    .find(
      (name) => name.startsWith(`${String(migration).padStart(4, "0")}_`) && name.endsWith(".sql"),
    );

describe("committed grants migrations equal the generator output", () => {
  it("0026_runtime_grants.sql", () => {
    const file = fileOf(GRANTS_MIGRATION);
    expect(file).toBe("0026_runtime_grants.sql");
    const { header, body } = splitHeader(fs.readFileSync(`${folder}/${file}`, "utf8"));
    expect(header).toMatch(/pnpm db:grants:generate/);
    expect(body).toBe(renderGrantsSql(APP_SCHEMAS, { migration: GRANTS_MIGRATION }));
  });

  it("starts with the ownership assertion, before any REVOKE", () => {
    const first = renderGrantsSql(APP_SCHEMAS).split("\n--> statement-breakpoint\n")[0] ?? "";
    expect(first).toMatch(/^DO \$\$/);
    expect(first).toContain("pg_has_role");
    expect(first).toContain("'pgboss'");
  });

  it("a schema introduced after 0026 gets the ownership assertion first, then its USAGE", () => {
    for (const schema of APP_SCHEMAS.filter(
      (s) => (s.since ?? GRANTS_MIGRATION) > GRANTS_MIGRATION,
    )) {
      const [first, second] = renderGrantsSql(APP_SCHEMAS, {
        migration: schema.since ?? GRANTS_MIGRATION,
      }).split("\n--> statement-breakpoint\n");
      expect(first, schema.schema).toMatch(/^DO \$\$/);
      expect(first, schema.schema).toContain(`n.nspname IN ('${schema.schema}')`);
      expect(second, schema.schema).toBe(`GRANT USAGE ON SCHEMA "${schema.schema}" TO "igs_app";`);
    }
  });

  it("every later grants migration (entries with `since`) is committed and equal", () => {
    const later = new Set(
      APP_SCHEMAS.flatMap((s) => [
        s.since ?? GRANTS_MIGRATION,
        ...s.objects.map((o) => o.since ?? GRANTS_MIGRATION),
      ]).filter((n) => n > GRANTS_MIGRATION),
    );
    for (const migration of later) {
      const file = fileOf(migration);
      expect(file, `drizzle/${migration}_*.sql for entries with since: ${migration}`).toBeDefined();
      const { body } = splitHeader(fs.readFileSync(`${folder}/${file}`, "utf8"));
      expect(body).toBe(renderGrantsSql(APP_SCHEMAS, { migration }));
    }
  });
});

describe("the pgboss grants", () => {
  it("go out as one script (one implicit transaction), identical to the statement list", () => {
    expect(renderPgbossGrantsScript()).toBe(renderPgbossGrantsSql().join("\n"));
    expect(
      renderPgbossGrantsSql().some((s) => s.startsWith("REVOKE") && s.includes("version")),
    ).toBe(true);
  });
});
