/**
 * Fails on circular dependencies between workspace packages (apps + packages + modules).
 * Zero-dependency on purpose (no dependency-cruiser / import-x added); package-level cycles are
 * what break the build graph and the "no circular deps between packages" rule. File-level cycles
 * inside one package are out of scope here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadWorkspaceGraph(rootDir = root) {
  const graph = new Map();
  for (const rel of ["apps", "packages", "packages/modules"]) {
    const base = path.join(rootDir, rel);
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const manifest = path.join(base, entry.name, "package.json");
      if (!entry.isDirectory() || !fs.existsSync(manifest)) continue;
      const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
      graph.set(pkg.name, pkg);
    }
  }
  const edges = new Map();
  for (const [name, pkg] of graph) {
    const deps = { ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.dependencies };
    edges.set(
      name,
      Object.keys(deps).filter((d) => graph.has(d)),
    );
  }
  return edges;
}

/** Returns the first cycle found as an array of names (first === last), or null. */
export function findCycle(edges) {
  const state = new Map(); // 1 = visiting, 2 = done
  const stack = [];
  const visit = (node) => {
    if (state.get(node) === 2) return null;
    if (state.get(node) === 1) return [...stack.slice(stack.indexOf(node)), node];
    state.set(node, 1);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(node, 2);
    return null;
  };
  for (const node of edges.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cycle = findCycle(loadWorkspaceGraph());
  if (cycle) {
    console.error(`Circular workspace dependency: ${cycle.join(" -> ")}`);
    process.exit(1);
  }
  process.stdout.write("No circular dependencies between workspace packages.\n");
}
