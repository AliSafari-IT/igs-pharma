/**
 * eslint-module-utils resolver for the boundaries plugin.
 *
 * Maps `@igs/<pkg>[/subpath]` to the workspace package's source file using its package.json
 * `exports` map (internal packages ship TS source, D-007). Everything else falls through to
 * the plugin's default node resolver (relative imports, externals).
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const workspaceDirs = ["apps", "packages", path.join("packages", "modules")];

let cache;
function packages() {
  if (cache) return cache;
  cache = new Map();
  for (const rel of workspaceDirs) {
    const base = path.join(root, rel);
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const manifest = path.join(base, entry.name, "package.json");
      if (!entry.isDirectory() || !fs.existsSync(manifest)) continue;
      const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
      cache.set(pkg.name, { dir: path.join(base, entry.name), exports: pkg.exports ?? {} });
    }
  }
  return cache;
}

function target(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.default ?? value.import ?? value.types;
  return undefined;
}

module.exports = {
  interfaceVersion: 2,
  resolve(source) {
    const match = /^(@igs\/[^/]+)(\/.*)?$/.exec(source);
    if (!match) return { found: false };
    const pkg = packages().get(match[1]);
    if (!pkg) return { found: false };
    const key = match[2] ? `.${match[2]}` : ".";
    const file = target(pkg.exports[key]);
    if (!file) return { found: false };
    const resolved = path.resolve(pkg.dir, file);
    return fs.existsSync(resolved) ? { found: true, path: resolved } : { found: false };
  },
};
