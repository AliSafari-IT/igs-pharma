/**
 * ESLint is used ONLY for architectural boundaries (D-002). Style/lint is Biome's job.
 * Rules: docs/06-engineering/repository-structure.md; anatomy: docs/06-engineering/module-anatomy.md.
 */
import { createRequire } from "node:module";
import tsParser from "@typescript-eslint/parser";
import boundaries from "eslint-plugin-boundaries";

const require = createRequire(import.meta.url);
const resolver = require.resolve("./tools/boundaries/resolver.cjs");

const infra = ["config", "crypto", "db", "auth", "observability", "ui", "i18n", "kernel"];

/** Test code: the only place `@igs/db/testing` may be imported from. */
const TEST_FILES = [
  "**/*.test.{ts,tsx,mts}",
  "**/*.spec.{ts,tsx,mts}",
  "**/test/**/*.{ts,tsx,mts}",
  "**/vitest.config.ts",
];

const TESTING_MESSAGE =
  "@igs/db/testing is test-only: import it from test code only (**/*.test.ts, **/test/**, **/vitest.config.ts)";

const KERNEL_MESSAGE =
  "@igs/kernel exposes only its public entry point (@igs/kernel); @igs/kernel/testing is test-only (**/*.test.ts, **/test/**, **/vitest.config.ts) and system.* tables are reached through commands (D-015, D-017)";

/**
 * entry-point options. `dbRules` decides what may be imported from @igs/db; `kernelAllow` which
 * kernel entries are importable (test code additionally gets `src/testing/**`, A8).
 */
const entryPoint = (dbRules, kernelAllow = "src/index.ts") => [
  "error",
  {
    default: "disallow",
    message: "Deep import into ${dependency.source}: import the module's public entry point only",
    rules: [
      // modules expose src/index.ts only; infra packages expose their package.json#exports
      { target: "module", allow: "src/index.ts" },
      {
        target: [...infra.filter((name) => name !== "db" && name !== "kernel"), "app"],
        allow: "**",
      },
      { target: "kernel", disallow: "**", message: KERNEL_MESSAGE },
      { target: "kernel", allow: kernelAllow },
      ...dbRules,
    ],
  },
];

export default [
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/drizzle/**", "**/.turbo/**"] },
  {
    files: ["apps/**/*.{ts,tsx,mts}", "packages/**/*.{ts,tsx,mts}"],
    languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: "module" },
    plugins: { boundaries },
    settings: {
      "import/resolver": {
        [resolver]: {},
        // relative imports: extensionless TS/TSX (the plugin bundles this resolver)
        node: { extensions: [".ts", ".tsx", ".mts", ".js", ".mjs", ".json"] },
      },
      "boundaries/elements": [
        { type: "app", pattern: "apps/*", capture: ["app"] },
        // must come before the generic packages entries: packages/modules/<name>
        { type: "module", pattern: "packages/modules/*", capture: ["module"] },
        ...infra.map((name) => ({ type: name, pattern: `packages/${name}` })),
      ],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          message: "${file.type} must not import ${dependency.type} (see module-anatomy.md)",
          rules: [
            // apps may import packages and modules, never another app
            { from: "app", allow: [...infra, "module", ["app", { app: "${from.app}" }]] },
            // modules: infra + other modules (public entry point only, enforced below)
            {
              from: "module",
              allow: [
                "db",
                "auth",
                "crypto",
                "observability",
                "config",
                "kernel",
                ["module", { module: "!${from.module}" }],
              ],
            },
            // D-011: identity owns tables only; auth imports identity, never the reverse
            { from: [["module", { module: "identity" }]], disallow: ["auth"] },
            // infra packages
            { from: "kernel", allow: ["db", "auth", "observability", "config"] },
            {
              from: "auth",
              allow: [
                "config",
                "db",
                "crypto",
                "observability",
                ["module", { module: "identity" }],
              ],
            },
            { from: "db", allow: ["config"] },
            { from: "observability", allow: ["config"] },
            { from: "i18n", allow: [] },
            { from: "crypto", allow: [] },
            { from: "config", allow: [] },
            { from: "ui", allow: [] },
          ],
        },
      ],
      // Entry points per target. The default (this block) covers every non-test file; the blocks
      // below override it for apps (D-015) and for test code.
      "boundaries/entry-point": entryPoint([
        { target: "db", allow: "**" },
        { target: "db", disallow: "src/testing/**", message: TESTING_MESSAGE },
      ]),
    },
  },

  // --- D-015: apps reach data only through module APIs / the kernel -----------------------------
  // entry-point rules cannot filter on the importer, so each app gets its own block.
  ...[
    { app: "web", entry: "src/health.ts", note: "apps/web may only use @igs/db/health" },
    { app: "platform", entry: "src/health.ts", note: "apps/platform may only use @igs/db/health" },
    // T-005b (A7): the worker's exemption is gone — it reaches data through @igs/kernel only.
    { app: "worker", entry: undefined, note: "apps/worker may only use @igs/kernel (no @igs/db)" },
  ].map(({ app, entry, note }) => ({
    files: [`apps/${app}/**/*.{ts,tsx,mts}`],
    rules: {
      "boundaries/entry-point": entryPoint([
        {
          target: "db",
          disallow: "**",
          message: `D-015: ${note}; apps read and write data only through module public APIs / the kernel (see module-anatomy.md)`,
        },
        ...(entry ? [{ target: "db", allow: entry }] : []),
      ]),
    },
  })),

  // --- @igs/db/testing and @igs/kernel/testing are test-only -----------------------------------------------------------------
  // Test code may use the harness (and, being non-production, the rest of @igs/db). Listed last so
  // it overrides the app blocks above for test files.
  {
    files: TEST_FILES,
    rules: {
      "boundaries/entry-point": entryPoint(
        [{ target: "db", allow: "**" }],
        ["src/index.ts", "src/testing/**"],
      ),
    },
  },
];
