/**
 * Negative tests for the architecture boundaries (T-003).
 * Lints in-memory snippets against the real eslint.config.mjs, using virtual file paths, so no
 * violating file ever exists on disk or in a production build. Run: `pnpm test:boundaries`.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const eslint = new ESLint({ cwd: root });

async function violations(file, code) {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
  return result.messages.filter((m) => m.ruleId?.startsWith("boundaries/"));
}

const mustFail = (name, file, code, ruleId) =>
  test(`rejects: ${name}`, async () => {
    const found = await violations(file, code);
    assert.ok(
      found.some((m) => m.ruleId === ruleId),
      `expected ${ruleId}, got: ${JSON.stringify(found.map((m) => `${m.ruleId}: ${m.message}`))}`,
    );
  });

const mustPass = (name, file, code) =>
  test(`allows: ${name}`, async () => {
    assert.deepEqual(await violations(file, code), []);
  });

// --- the three required negatives -----------------------------------------------------------
mustFail(
  "deep import into a module",
  "apps/web/src/app/x.ts",
  'import { users } from "@igs/module-identity/schema";\nconsole.log(users);\n',
  "boundaries/entry-point",
);
mustFail(
  "app -> app import",
  "apps/web/src/app/x.ts",
  'import page from "../../../platform/src/app/page";\nconsole.log(page);\n',
  "boundaries/element-types",
);
mustFail(
  "ui -> modules import",
  "packages/ui/src/x.ts",
  'import { identitySchema } from "@igs/module-identity";\nconsole.log(identitySchema);\n',
  "boundaries/element-types",
);

// --- D-011 reverse direction + other hard rules ---------------------------------------------
mustFail(
  "module-identity -> @igs/auth (D-011)",
  "packages/modules/identity/src/x.ts",
  'import { getAuth } from "@igs/auth";\nconsole.log(getAuth);\n',
  "boundaries/element-types",
);
mustFail(
  "db -> modules",
  "packages/db/src/x.ts",
  'import { identitySchema } from "@igs/module-identity";\nconsole.log(identitySchema);\n',
  "boundaries/element-types",
);
mustFail(
  "package -> app",
  "packages/config/src/x.ts",
  'import page from "../../../apps/web/src/app/[locale]/page";\nconsole.log(page);\n',
  "boundaries/element-types",
);

// --- the kernel (T-005a) ------------------------------------------------------------------------
mustFail(
  "kernel -> module",
  "packages/kernel/src/x.ts",
  'import { identitySchema } from "@igs/module-identity";\nconsole.log(identitySchema);\n',
  "boundaries/element-types",
);
mustFail(
  "kernel -> app",
  "packages/kernel/src/x.ts",
  'import page from "../../../apps/web/src/app/[locale]/page";\nconsole.log(page);\n',
  "boundaries/element-types",
);
mustFail(
  "module src -> @igs/kernel/testing (A8)",
  "packages/modules/identity/src/x.ts",
  'import { actors } from "@igs/kernel/testing";\nconsole.log(actors);\n',
  "boundaries/entry-point",
);
mustFail(
  "app src -> @igs/kernel/testing (A8)",
  "apps/web/src/app/x.ts",
  'import { actors } from "@igs/kernel/testing";\nconsole.log(actors);\n',
  "boundaries/entry-point",
);
mustFail(
  "module src -> @igs/kernel/schema (system tables are reached through commands)",
  "packages/modules/identity/src/x.ts",
  'import { idempotencyKeys } from "@igs/kernel/schema";\nconsole.log(idempotencyKeys);\n',
  "boundaries/entry-point",
);
mustPass(
  "module test/ file -> @igs/kernel/testing",
  "packages/modules/identity/test/x.ts",
  'import { actors } from "@igs/kernel/testing";\nconsole.log(actors);\n',
);
mustPass(
  "*.test.ts -> @igs/kernel/testing",
  "packages/modules/identity/src/x.test.ts",
  'import { actors } from "@igs/kernel/testing";\nconsole.log(actors);\n',
);
mustPass(
  "module -> @igs/kernel public entry",
  "packages/modules/identity/src/x.ts",
  'import { command } from "@igs/kernel";\nconsole.log(command);\n',
);
mustPass(
  "kernel -> auth/permissions, observability, db/client",
  "packages/kernel/src/x.ts",
  'import { hasPermission } from "@igs/auth/permissions";\nimport { logger } from "@igs/observability/logger";\nimport { getDb } from "@igs/db/client";\nconsole.log(hasPermission, logger, getDb);\n',
);

// --- sanity: legitimate imports stay legal --------------------------------------------------
mustPass(
  "auth -> module-identity public entry (D-011 exception)",
  "packages/auth/src/x.ts",
  'import { identitySchema } from "@igs/module-identity";\nconsole.log(identitySchema);\n',
);
// --- D-015: apps reach data only via @igs/db/health (worker: only the kernel, since T-005b) -----------------
mustPass(
  "apps/web -> @igs/db/health (D-015)",
  "apps/web/src/app/x.ts",
  'import { dbHealthCheck } from "@igs/db/health";\nconsole.log(dbHealthCheck);\n',
);
mustFail(
  "apps/web -> @igs/db/client (D-015)",
  "apps/web/src/app/x.ts",
  'import { getDb } from "@igs/db/client";\nconsole.log(getDb);\n',
  "boundaries/entry-point",
);
mustFail(
  "apps/platform -> @igs/db/ids (D-015)",
  "apps/platform/src/app/x.ts",
  'import { newId } from "@igs/db/ids";\nconsole.log(newId);\n',
  "boundaries/entry-point",
);
mustFail(
  "apps/web -> @igs/db root entry (D-015)",
  "apps/web/src/app/x.ts",
  'import { getDb } from "@igs/db";\nconsole.log(getDb);\n',
  "boundaries/entry-point",
);
mustFail(
  "apps/worker -> @igs/db/client (exemption removed in T-005b, A7)",
  "apps/worker/src/x.ts",
  'import { getDb } from "@igs/db/client";\nconsole.log(getDb);\n',
  "boundaries/entry-point",
);
mustPass(
  "apps/worker -> @igs/kernel (A7)",
  "apps/worker/src/x.ts",
  'import { startOutboxRelay } from "@igs/kernel";\nconsole.log(startOutboxRelay);\n',
);

// --- @igs/db/testing is test-only -----------------------------------------------------------------
mustFail(
  "module src -> @igs/db/testing",
  "packages/modules/identity/src/x.ts",
  'import { withTestTx } from "@igs/db/testing";\nconsole.log(withTestTx);\n',
  "boundaries/entry-point",
);
mustFail(
  "app src -> @igs/db/testing",
  "apps/web/src/app/x.ts",
  'import { withTestTx } from "@igs/db/testing";\nconsole.log(withTestTx);\n',
  "boundaries/entry-point",
);
mustFail(
  "module src -> @igs/db/testing/global-setup",
  "packages/modules/identity/src/x.ts",
  'import setup from "@igs/db/testing/global-setup";\nconsole.log(setup);\n',
  "boundaries/entry-point",
);
mustPass(
  "module test/ file -> @igs/db/testing",
  "packages/modules/identity/test/x.ts",
  'import { withTestTx } from "@igs/db/testing";\nconsole.log(withTestTx);\n',
);
mustPass(
  "*.test.ts -> @igs/db/testing",
  "packages/modules/identity/src/x.test.ts",
  'import { withTestTx } from "@igs/db/testing";\nconsole.log(withTestTx);\n',
);
mustPass(
  "vitest.config.ts -> @igs/db/testing/global-setup",
  "packages/modules/identity/vitest.config.ts",
  'import setup from "@igs/db/testing/global-setup";\nconsole.log(setup);\n',
);

mustPass(
  "module -> db helper",
  "packages/modules/identity/src/x.ts",
  'import { newId } from "@igs/db/ids";\nconsole.log(newId);\n',
);

// --- circular dependencies between packages -------------------------------------------------
import { findCycle, loadWorkspaceGraph } from "./check-cycles.mjs";

test("rejects: a circular package dependency (auth <-> module-identity)", () => {
  const edges = new Map([
    ["@igs/auth", ["@igs/module-identity"]],
    ["@igs/module-identity", ["@igs/auth"]],
  ]);
  assert.deepEqual(findCycle(edges), ["@igs/auth", "@igs/module-identity", "@igs/auth"]);
});

test("allows: the real workspace graph has no cycle", () => {
  assert.equal(findCycle(loadWorkspaceGraph()), null);
});
