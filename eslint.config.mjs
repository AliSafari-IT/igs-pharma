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
      // A module is only reachable through its public entry point (src/index.ts)
      "boundaries/entry-point": [
        "error",
        {
          default: "disallow",
          message:
            "Deep import into ${dependency.source}: import the module's public entry point only",
          rules: [
            // modules expose src/index.ts only; infra packages expose their package.json#exports
            { target: "module", allow: "src/index.ts" },
            { target: [...infra, "app"], allow: "**" },
          ],
        },
      ],
    },
  },
];
