// Every variable in env.ts is classified, and the image secret check covers every sensitive one
// (igs-pharma#96, D-023). Names and synthetic fixtures only: no real secret value appears here.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import * as envModule from "./env";
import { ENV_SENSITIVITY, SENSITIVE_ENV_NAMES } from "./env-sensitivity";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const envSource = readFileSync(fileURLToPath(new URL("./env.ts", import.meta.url)), "utf8");

/** The UPPER_CASE keys of every inline `.extend({ ... })` in a source text (not a named schema). */
const inlineExtendKeys = (source: string) =>
  [...source.matchAll(/\.extend\(\{([^}]*)\}\)/g)].flatMap((block) =>
    [...String(block[1]).matchAll(/\b([A-Z][A-Z0-9_]+)\s*:/g)].map((m) => String(m[1])),
  );

/** Every variable name any exported schema of env.ts declares, and any inline `.extend` adds. */
const declared = [
  ...new Set([
    ...Object.values(envModule as Record<string, unknown>)
      .filter((value): value is z.ZodObject => value instanceof z.ZodObject)
      .flatMap((schema) => Object.keys(schema.shape)),
    ...inlineExtendKeys(envSource),
  ]),
].sort();

/** Names of the `const X = z.object(` schemas env.ts declares, exported or not. */
const schemaConsts = (source: string) =>
  [...source.matchAll(/^(?:export )?const (\w+) = z\.object\(/gm)].map((m) => String(m[1]));

/** Variables read from `process.env` that are not the app's configuration (tooling, CI, the platform). */
const NOT_APP_CONFIG: readonly string[] = [
  "CI",
  "TEST_DATABASE_URL",
  "SMOKE_DATABASE_URL",
  "PLAYWRIGHT_CHROMIUM_EXECUTABLE",
  "DRIZZLE_OUT",
  "NEXT_RUNTIME",
  "PORT",
  "HOSTNAME",
  // the Android app's storefront address, baked into each EAS build (apps/mobile/eas.json); the
  // app is not a server and never reads env.ts
  "EXPO_PUBLIC_STOREFRONT_URL",
];

/** The names `process.env.X` / `process.env["X"]` read in a source text. */
const envReads = (source: string) =>
  [...source.matchAll(/process\.env(?:\.|\[["'])([A-Z][A-Z0-9_]+)/g)].map((m) => String(m[1]));

/** Every non-test source file under apps/<x>/src and packages/<x>/src (and packages/modules/<x>/src). */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", "dist", "test", "tests"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|mjs)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name))
      out.push(path);
  }
  return out;
}

/** Variable names read in app and package sources that no classification mentions. */
const unknownReads = (reads: readonly string[]) =>
  [...new Set(reads)].filter(
    (name) => !Object.hasOwn(ENV_SENSITIVITY, name) && !NOT_APP_CONFIG.includes(name),
  );

const scriptPath = fileURLToPath(
  new URL("../../../tools/ci/check-image-secrets.sh", import.meta.url),
);

/** The names the script greps for, from its `names='A|B|C'` line. */
function scriptNames(source: string): string[] {
  const match = /^names='([^']+)'/m.exec(source);
  return match?.[1]?.split("|") ?? [];
}

/** Names in `declared` that `classified` does not list. */
const unclassified = (names: readonly string[], classified: Record<string, string>) =>
  names.filter((name) => !Object.hasOwn(classified, name));

/** `sensitive` names that a script's name list does not cover. */
const uncovered = (sensitive: readonly string[], covered: readonly string[]) =>
  sensitive.filter((name) => !covered.includes(name));

describe("env classification (D-023)", () => {
  it("finds the variables of env.ts", () => {
    expect(declared).toContain("DATABASE_URL");
    expect(declared).toContain("AUDIT_HMAC_KEY");
    expect(declared.length).toBeGreaterThan(15);
  });

  it("classifies every variable env.ts declares", () => {
    expect(unclassified(declared, ENV_SENSITIVITY)).toEqual([]);
  });

  it("exports every schema env.ts declares, so the scan above cannot miss one (#100)", () => {
    const exported = new Set(Object.keys(envModule));
    expect(schemaConsts(envSource).filter((name) => !exported.has(name))).toEqual([]);
    expect(schemaConsts(envSource)).toContain("envSchema");
  });

  it("no source under apps/ or packages/ reads a variable that is not classified", () => {
    const reads = ["apps", "packages"].flatMap((top) =>
      sourceFiles(join(root, top)).flatMap((file) => envReads(readFileSync(file, "utf8"))),
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(unknownReads(reads)).toEqual([]);
  });

  it("lists no variable that env.ts no longer declares", () => {
    expect(Object.keys(ENV_SENSITIVITY).filter((name) => !declared.includes(name))).toEqual([]);
  });

  it("marks the credentials and keys sensitive, including the two the script used to miss", () => {
    for (const name of [
      "DATABASE_URL",
      "DATABASE_MIGRATE_URL",
      "AUTH_SECRET",
      "AUDIT_HMAC_KEY",
      "ENCRYPTION_KEY",
      "KMS_KEY_ID",
      "SENTRY_DSN",
    ]) {
      expect(SENSITIVE_ENV_NAMES, name).toContain(name);
    }
  });

  it("the image secret check greps for every sensitive name", () => {
    const names = scriptNames(readFileSync(scriptPath, "utf8"));
    expect(names.length).toBeGreaterThan(0);
    expect(uncovered(SENSITIVE_ENV_NAMES, names)).toEqual([]);
  });
});

describe("the guards themselves (synthetic fixtures)", () => {
  it("an unclassified new variable is reported", () => {
    expect(unclassified([...declared, "NEW_THING"], ENV_SENSITIVITY)).toEqual(["NEW_THING"]);
  });

  it("an inline .extend({...}) key and a process.env['X'] read are seen too (#110)", () => {
    const source = "const s = base.extend({ PAYMENT_API_SECRET: z.string() });";
    expect(inlineExtendKeys(source)).toEqual(["PAYMENT_API_SECRET"]);
    expect(unclassified(inlineExtendKeys(source), ENV_SENSITIVITY)).toEqual(["PAYMENT_API_SECRET"]);
    expect(envReads("process.env['PAYMENT_API_SECRET']")).toEqual(["PAYMENT_API_SECRET"]);
    // the real env.ts has inline extends whose keys are classified
    expect(inlineExtendKeys(envSource)).toContain("DATABASE_URL");
  });

  it("an unexported schema is reported (a PAYMENT_API_SECRET in a private z.object)", () => {
    const source = `${envSource}\nconst paymentEnv = z.object({ PAYMENT_API_SECRET: z.string() });\n`;
    expect(schemaConsts(source).filter((n) => !Object.hasOwn(envModule, n))).toEqual([
      "paymentEnv",
    ]);
  });

  it("a variable read straight from process.env without a classification is reported", () => {
    const reads = envReads('const key = process.env.PAYMENT_API_SECRET; process.env["CI"];');
    expect(unknownReads(reads)).toEqual(["PAYMENT_API_SECRET"]);
  });

  it("a sensitive name missing from the script is reported", () => {
    const script = "names='AUTH_SECRET|DATABASE_URL'\n";
    expect(uncovered(["AUTH_SECRET", "SENTRY_DSN"], scriptNames(script))).toEqual(["SENTRY_DSN"]);
  });

  it("a script with no name list covers nothing", () => {
    expect(scriptNames("echo hello")).toEqual([]);
  });
});
