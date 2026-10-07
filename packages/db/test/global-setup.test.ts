import postgres from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inject } from "vitest";

import setup from "../src/testing/global-setup";

// A broken migration chain (e.g. missing meta/_journal.json) must fail setup loudly AND leave
// nothing behind — a leaked container/connection is what made Vitest hang in CI (T-004 R2).
vi.mock("../src/testing/migrate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/testing/migrate")>()),
  applyMigrations: vi.fn().mockRejectedValue(new Error("Can't find meta/_journal.json file")),
}));

describe("global setup failure", () => {
  const original = process.env["TEST_DATABASE_URL"];

  afterEach(() => {
    if (original === undefined) Reflect.deleteProperty(process.env, "TEST_DATABASE_URL");
    else process.env["TEST_DATABASE_URL"] = original;
  });

  it("rethrows the original error and drops the databases it created", async () => {
    // external-server mode, pointed at this run's server
    process.env["TEST_DATABASE_URL"] = inject("igsTestAdminUrl");
    const provided: string[] = [];

    await expect(setup({ provide: (key: string) => provided.push(key) } as never)).rejects.toThrow(
      "Can't find meta/_journal.json file",
    );
    expect(provided).toEqual([]);

    const probe = postgres(inject("igsTestAdminUrl"), { max: 1 });
    try {
      // this run's own databases (prefix igs_test_<run>) survive; a failed setup's must not
      const rows = await probe<{ datname: string }[]>`
        SELECT datname FROM pg_database WHERE datname LIKE 'igs\_test\_%\_template'`;
      expect(rows.map((r) => r.datname)).toEqual([inject("igsTestTemplateDb")]);
    } finally {
      await probe.end({ timeout: 5 });
    }
  });
});
