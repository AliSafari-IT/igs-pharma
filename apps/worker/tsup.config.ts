import fs from "node:fs";
import { builtinModules } from "node:module";
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
 * actually imports (including via inlined @igs/* sources) must be declared by the worker itself —
 * otherwise `node dist/index.js` fails with ERR_MODULE_NOT_FOUND in the image. Fail the build instead.
 *
 * Checked against the real bundle (not the dependency closure), so a package that is only reachable
 * through an unused import (e.g. better-auth behind `@igs/auth/permissions`) is not dragged into the image.
 */
function assertBundleImportsDeclared(): void {
  const own = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8")) as Manifest;
  const bundle = fs.readFileSync(path.join(here, "dist", "index.js"), "utf8");
  const imported = new Set<string>();
  for (const match of bundle.matchAll(
    /(?:from\s*|import\s*\(?\s*|import\s+)["']([^"'.\/][^"']*)["']/g,
  )) {
    const spec = match[1] as string;
    if (spec.startsWith("node:")) continue;
    const parts = spec.split("/");
    imported.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] as string));
  }
  const missing = [...imported].filter(
    (dep) => !(dep in (own.dependencies ?? {})) && !builtinModules.includes(dep),
  );
  if (missing.length > 0) {
    throw new Error(
      `apps/worker/package.json must list these runtime dependencies (imported by dist/index.js): ${missing.join(", ")}`,
    );
  }
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
  external: thirdPartyDependencies("@igs/worker"),
  onSuccess: async () => assertBundleImportsDeclared(),
  esbuildOptions(options) {
    options.alias = { ...options.alias, "server-only": path.join(here, "src/server-only.stub.ts") };
  },
});
