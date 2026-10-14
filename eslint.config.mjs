/**
 * ESLint is used ONLY for architectural boundaries (D-002). Style/lint is Biome's job.
 * Rules: asafarim-docs:ventures/igs-pharma/06-engineering/repository-structure.md; anatomy: module-anatomy.md (same folder).
 */
import { createRequire } from "node:module";
import tsParser from "@typescript-eslint/parser";
import boundaries from "eslint-plugin-boundaries";

const require = createRequire(import.meta.url);
const resolver = require.resolve("./tools/boundaries/resolver.cjs");

const infra = [
  "config",
  "crypto",
  "db",
  "auth",
  "observability",
  "ui",
  "i18n",
  "kernel",
  "rbac",
  "security-headers",
  "time",
];

/** Test code: the only place `@igs/db/testing` may be imported from. */
const TEST_FILES = [
  "**/*.test.{ts,tsx,mts}",
  "**/*.spec.{ts,tsx,mts}",
  "**/test/**/*.{ts,tsx,mts}",
  "**/vitest.config.ts",
  // the kernel's own test kit is test-only itself (KERNEL_MESSAGE), so it may use other test kits
  "packages/kernel/src/testing/**",
];

const TESTING_MESSAGE =
  "@igs/db/testing is test-only: import it from test code only (**/*.test.ts, **/test/**, **/vitest.config.ts)";

const RBAC_MESSAGE =
  "@igs/rbac/testing is test-only: import it from test code only (**/*.test.ts, **/test/**, **/vitest.config.ts)";

const KERNEL_MESSAGE =
  "@igs/kernel exposes only its public entry point (@igs/kernel); @igs/kernel/testing is test-only (**/*.test.ts, **/test/**, **/vitest.config.ts) and system.* tables are reached through commands (D-015, D-017)";

/**
 * entry-point options. `dbRules` decides what may be imported from @igs/db; `kernelAllow` which
 * kernel entries are importable (test code additionally gets `src/testing/**`, A8).
 */
const entryPoint = (
  dbRules,
  kernelAllow = "src/index.ts",
  rbacAllow = "src/index.ts",
  storefrontAllow = "src/index.ts",
) => [
  "error",
  {
    default: "disallow",
    message: "Deep import into ${dependency.source}: import the module's public entry point only",
    rules: [
      // modules expose src/index.ts only; infra packages expose their package.json#exports
      { target: "module", allow: "src/index.ts" },
      // the fixtures of the storefront contract are for test code (see the test block below)
      { target: "storefront-module", allow: storefrontAllow },
      {
        target: [
          ...infra.filter((name) => name !== "db" && name !== "kernel" && name !== "rbac"),
          "mail",
          "app",
        ],
        allow: "**",
      },
      { target: "rbac", disallow: "**", message: RBAC_MESSAGE },
      { target: "rbac", allow: rbacAllow },
      { target: "kernel", disallow: "**", message: KERNEL_MESSAGE },
      { target: "kernel", allow: kernelAllow },
      ...dbRules,
    ],
  },
];

export default [
  {
    // e2e is not a workspace package under the boundary rules (its *.spec.ts would hit the test block)
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/drizzle/**",
      "**/.turbo/**",
      "e2e/**",
    ],
  },
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
        // the storefront read model (igs-pharma#103) composes other modules; only apps import it
        // (must come before the generic module entry)
        { type: "storefront-module", pattern: "packages/modules/storefront" },
        // SMTP lives here and nowhere else (igs-pharma#114, D-019): only the worker app may import it
        { type: "mail", pattern: "packages/mail" },
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
            {
              from: "app",
              allow: [...infra, "module", "storefront-module", ["app", { app: "${from.app}" }]],
            },
            // the one app that sends mail (the mail package is NOT in `infra`; no other app imports it)
            { from: [["app", { app: "worker" }]], allow: ["mail"] },
            // the read model: kernel + rbac + the modules it composes; no module imports it back
            {
              from: "storefront-module",
              allow: ["kernel", "rbac", "config", "observability", "time", "module"],
            },
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
                "rbac",
                "time",
                ["module", { module: "!${from.module}" }],
              ],
            },
            // D-011: identity owns the identity tables and commands; auth imports identity, never the reverse
            { from: [["module", { module: "identity" }]], disallow: ["auth"] },
            // infra packages
            { from: "kernel", allow: ["db", "rbac", "observability", "config"] },
            {
              from: "auth",
              allow: [
                "config",
                "db",
                "crypto",
                "observability",
                "rbac",
                ["module", { module: "identity" }],
              ],
            },
            { from: "db", allow: ["config"] },
            { from: "observability", allow: ["config"] },
            // T-016 option C: the RBAC catalogue is a leaf, so kernel, auth and modules share it cycle-free
            { from: "rbac", allow: [] },
            // calendar arithmetic is a pure leaf shared by modules (igs-pharma#83)
            { from: "time", allow: [] },
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
        ["src/index.ts", "src/testing.ts"],
        ["src/index.ts", "src/fixtures.ts"],
      ),
    },
  },
];
