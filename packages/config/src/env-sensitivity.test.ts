// Every variable in env.ts is classified, and the image secret check covers every sensitive one
// (igs-pharma#96, D-023). Names and synthetic fixtures only: no real secret value appears here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import * as envModule from "./env";
import { ENV_SENSITIVITY, SENSITIVE_ENV_NAMES } from "./env-sensitivity";

/** Every variable name any exported schema of env.ts declares. */
const declared = [
  ...new Set(
    Object.values(envModule as Record<string, unknown>)
      .filter((value): value is z.ZodObject => value instanceof z.ZodObject)
      .flatMap((schema) => Object.keys(schema.shape)),
  ),
].sort();

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

  it("lists no variable that env.ts no longer declares", () => {
    expect(Object.keys(ENV_SENSITIVITY).filter((name) => !declared.includes(name))).toEqual([]);
  });

  it("marks the credentials and keys sensitive, including the two the script used to miss", () => {
    for (const name of [
      "DATABASE_URL",
      "DATABASE_MIGRATE_URL",
      "AUTH_SECRET",
      "AUDIT_HMAC_KEY",
      "IGS_PREVIEW_KEY",
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

  it("a sensitive name missing from the script is reported", () => {
    const script = "names='AUTH_SECRET|DATABASE_URL'\n";
    expect(uncovered(["AUTH_SECRET", "SENTRY_DSN"], scriptNames(script))).toEqual(["SENTRY_DSN"]);
  });

  it("a script with no name list covers nothing", () => {
    expect(scriptNames("echo hello")).toEqual([]);
  });
});
