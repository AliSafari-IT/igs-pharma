# Module Anatomy

A **module** is a bounded context of the modular monolith (ADR-0001). This page is the contract
for creating one; the boundaries below are enforced in CI (`pnpm lint:boundaries`,
`pnpm test:boundaries`). Layout and dependency graph: [repository-structure.md](repository-structure.md).

## Naming

| Thing | Convention | Example |
|---|---|---|
| Folder | `packages/modules/<name>/` | `packages/modules/catalog/` |
| npm package | `@igs/module-<name>` (D-004) | `@igs/module-catalog` |
| Postgres schema | `<name>` via `pgSchema("<name>")` | `catalog.products` |
| Tables | plural snake_case; UUIDv7 ids (`newId()` from `@igs/db/ids`), `timestamptz` (D-003) | `catalog.product_content` |
| Public API | **only** `src/index.ts` | `import { publishProduct } from "@igs/module-catalog"` |
| Schema | `src/schema.ts` (D-001) | |

## Structure

```
packages/modules/<name>/
├── package.json          # name, "type": "module", exports: "." (+ "./schema" for drizzle-kit only)
├── tsconfig.json         # extends @igs/tsconfig/base.json
├── src/
│   ├── index.ts          # PUBLIC API: commands, queries, events, types — nothing else is importable
│   ├── schema.ts         # Drizzle tables for this module's Postgres schema
│   ├── commands/         # state-changing use cases (authorize → tx → audit → outbox)
│   ├── queries/          # read use cases
│   ├── events.ts         # events this module publishes
│   └── adapters/         # external systems behind ports (e.g. medipim/)
└── test/
```

Internal packages ship **TypeScript source** (D-007): relative imports are extensionless and the
package is consumed straight from `src/`.

## Rules (enforced)

1. **Public API only.** Anything outside a module imports it as `@igs/module-<name>` (root export, which resolves to `src/index.ts`). Deep imports (`@igs/module-x/schema`, relative paths into another module) fail `boundaries/entry-point`. `./schema` exists solely so drizzle-kit can glob it; app/package code must not import it.
2. **No foreign tables.** A module never queries or joins another module's tables. It calls the other module's public API or reacts to its events.
3. **Allowed dependencies of a module:** `db`, `auth`, `crypto`, `observability`, `config`, `kernel` (D-004), and *other modules through their public entry point*.
4. **Exception (D-011):** `@igs/auth` **may** import `@igs/module-identity` (adapter schema). `@igs/module-identity` **must never** import `@igs/auth` — it owns tables only; the reverse would be a cycle.
5. **`packages/db` and `packages/ui` never import modules.** `db` aggregates module schemas for drizzle-kit by path glob only (`../modules/*/src/schema.ts`, see `packages/db/README.md`). `ui` is pure presentation.
6. **Apps** may import any package or module, never another app. **Packages never import apps.**
7. **No cycles** between workspace packages (`tools/boundaries/check-cycles.mjs`).
8. Authorization lives in the command/query layer only (D-005); user-facing text is mapped at the edge via i18n (D-006). Server-only code carries `import "server-only"`.

## How it is enforced

| Mechanism | Where |
|---|---|
| `eslint-plugin-boundaries` (`element-types`, `entry-point`) | `eslint.config.mjs` — ESLint is used **only** for this (D-002); Biome does style/lint |
| Workspace resolver for `@igs/*` specifiers (reads each package's `exports`) | `tools/boundaries/resolver.cjs` |
| Cycle check between packages (zero-dependency script) | `tools/boundaries/check-cycles.mjs` |
| Negative tests (deep import, app→app, ui→modules, identity→auth, db→modules, package→app, cycles) | `tools/boundaries/boundaries.test.mjs` — lint in-memory snippets, nothing violating exists on disk or in builds |

Run locally: `pnpm lint:boundaries` and `pnpm test:boundaries`. CI's `lint` job runs both.

## Adding a module

1. Create the folder/package as above (copy `packages/modules/identity`).
2. Add `schema.ts` with `pgSchema("<name>")`; run `pnpm db:generate` — the glob picks it up.
3. Export only the public API from `src/index.ts`.
4. If it needs a new allowed dependency edge, change the rules in `eslint.config.mjs` **with an architect-approved decision**, never by exempting a file.
