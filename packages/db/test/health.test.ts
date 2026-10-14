// The database health check (igs-pharma#96): on failure it reports a short error class or code and
// never the driver's message, which can carry a statement, a host or a connection string.
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("../src/client", () => ({ getDb: () => ({ execute }) }));

import { dbHealthCheck, errorClassOf } from "../src/health";

beforeEach(() => {
  execute.mockReset();
});

describe("errorClassOf", () => {
  it("prefers a driver code, also from the cause", () => {
    expect(errorClassOf(Object.assign(new Error("boom"), { code: "28P01" }))).toBe("28P01");
    const wrapped = new Error("Failed query: SELECT 1", {
      cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), {
        code: "ECONNREFUSED",
      }),
    });
    expect(errorClassOf(wrapped)).toBe("ECONNREFUSED");
  });

  it("falls back to the error's class, then to a plain 'Error'", () => {
    class PoolTimeout extends Error {}
    expect(errorClassOf(new PoolTimeout("x"))).toBe("PoolTimeout");
    expect(errorClassOf("a string")).toBe("string");
    // a code that does not look like a code is not trusted
    expect(errorClassOf(Object.assign(new Error("x"), { code: "postgres://u:p@h/db" }))).toBe(
      "Error",
    );
  });
});

describe("dbHealthCheck", () => {
  it("reports ok with the latency", async () => {
    execute.mockResolvedValue([]);
    const result = await dbHealthCheck();
    expect(result.ok).toBe(true);
    expect(result.errorClass).toBeUndefined();
  });

  it("on failure holds no URL, credential, statement or driver message", async () => {
    execute.mockRejectedValue(
      Object.assign(
        new Error(
          "password authentication failed for postgres://igs_app:hunter2@db.internal:5432/igs",
        ),
        { code: "28P01", query: "SELECT 1 /* hunter2 */" },
      ),
    );
    const result = await dbHealthCheck();
    expect(result).toMatchObject({ ok: false, errorClass: "28P01" });
    const text = JSON.stringify(result);
    for (const leak of ["hunter2", "postgres://", "igs_app", "db.internal", "SELECT"]) {
      expect(text).not.toContain(leak);
    }
  });
});
