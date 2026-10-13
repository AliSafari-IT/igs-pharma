// `DATABASE_SSL=insecure-dev` switches off certificate verification (igs-pharma#77). It exists for
// development and the CI smoke run only: no deploy file may set it. The one allowed user is
// `e2e/smoke-env.ts`, which is not scanned here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const SKIP = new Set(["node_modules", ".git", ".turbo", ".next", "dist", "coverage"]);

/** Every file under `dir` (relative paths), skipping build and dependency folders. */
function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

const isDeployFile = (file: string) =>
  file.startsWith(`infra${path.sep}`) ||
  /(^|[\\/])(Dockerfile[^\\/]*|[^\\/]*\.Dockerfile)$/.test(file) ||
  /(^|[\\/])\.env(\.[^\\/]+)?$/.test(file) ||
  /(^|[\\/])(docker-)?compose[^\\/]*\.ya?ml$/.test(file);

// the variable set to insecure-dev, in .env, YAML, JSON or Dockerfile syntax (`ENV A=b`, `A: b`, `"A": "b"`)
const SETS_INSECURE = /DATABASE_SSL["']?\s*[=:]\s*["']?insecure-dev/;

describe("insecure-dev stays out of deploy files", () => {
  const files = walk(root).filter(isDeployFile);

  it("finds the deploy files it is supposed to guard", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        ".env.example",
        path.join("infra", "docker", "worker.Dockerfile"),
        path.join("infra", "db", "create-login-roles.sql"),
      ]),
    );
  });

  it("no infra file, Dockerfile, .env* or compose file sets DATABASE_SSL=insecure-dev", () => {
    const offenders = files.filter((file) =>
      SETS_INSECURE.test(fs.readFileSync(path.join(root, file), "utf8")),
    );
    expect(offenders, "deploy files must never turn off certificate verification").toEqual([]);
  });

  it("the guard itself catches the shapes a file could use", () => {
    for (const bad of [
      "DATABASE_SSL=insecure-dev",
      "ENV DATABASE_SSL=insecure-dev",
      "      DATABASE_SSL: insecure-dev",
      '      DATABASE_SSL: "insecure-dev"',
      '  "DATABASE_SSL": "insecure-dev"',
    ]) {
      expect(SETS_INSECURE.test(bad), bad).toBe(true);
    }
    for (const fine of [
      "DATABASE_SSL=",
      "DATABASE_SSL=verify",
      "# DATABASE_SSL: verify | insecure-dev | off",
    ]) {
      expect(SETS_INSECURE.test(fine), fine).toBe(false);
    }
  });

  it("the CI smoke environment is the one place that uses it", () => {
    expect(fs.readFileSync(path.join(root, "e2e", "smoke-env.ts"), "utf8")).toMatch(
      SETS_INSECURE_TS,
    );
  });
});

const SETS_INSECURE_TS = /DATABASE_SSL:\s*"insecure-dev"/;
