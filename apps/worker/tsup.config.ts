import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "tsup";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

type Manifest = { name: string; dependencies?: Record<string, string> };

/** package.json of every workspace package (apps, packages, packages/modules), by name. */
function workspaceManifests(): Map<string, Manifest> {
  const manifests = new Map<string, Manifest>();
  for (const dir of ["apps", "packages", path.join("packages", "modules")]) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const file = path.join(base, entry.name, "package.json");
      if (!entry.isDirectory() || !fs.existsSync(file)) continue;
      const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
      manifests.set(manifest.name, manifest);
    }
  }
  return manifests;
}

/**
 * Third-party packages used by the worker AND by the workspace packages it inlines.
 * They stay external (installed in the image by `pnpm deploy --prod`); only `@igs/*` source is bundled.
 */
function thirdPartyDependencies(entry: string): string[] {
  const manifests = workspaceManifests();
  const seen = new Set<string>();
  const external = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const dep of Object.keys(manifests.get(name)?.dependencies ?? {})) {
      if (dep.startsWith("@igs/")) visit(dep);
      else external.add(dep);
    }
  };
  visit(entry);
  external.delete("server-only"); // aliased below
  return [...external];
}

/**
 * pnpm only exposes a package's *direct* dependencies, so every third-party package the bundle
 * imports (including via inlined @igs/* sources) must be declared by the worker itself — otherwise
 * `node dist/index.js` fails with ERR_MODULE_NOT_FOUND in the image. Fail the build instead.
 */
function assertDeclared(external: string[]): string[] {
  const own = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8")) as Manifest;
  const missing = external.filter((dep) => !(dep in (own.dependencies ?? {})));
  if (missing.length > 0) {
    throw new Error(
      `apps/worker/package.json must list these runtime dependencies (used by inlined @igs/* packages): ${missing.join(", ")}`,
    );
  }
  return external;
}

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  // D-007: internal packages ship TS source, so they are inlined into the bundle…
  noExternal: [/^@igs\//],
  // …and everything third-party stays a runtime dependency of the image.
  external: assertDeclared(thirdPartyDependencies("@igs/worker")),
  esbuildOptions(options) {
    options.alias = { ...options.alias, "server-only": path.join(here, "src/server-only.stub.ts") };
  },
});
