// Readiness (igs-pharma#96): the public answer is { status, checks: { database: { ok } } } with the
// same status codes as before; version and latency go to the log, never a URL or a driver message.
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbHealthCheck = vi.fn();
const logger = { debug: vi.fn(), warn: vi.fn() };
vi.mock("@igs/db/health", () => ({ dbHealthCheck }));
vi.mock("@igs/observability", () => ({ logger }));

beforeEach(() => {
  dbHealthCheck.mockReset();
  logger.debug.mockReset();
  logger.warn.mockReset();
});

describe("GET /api/health", () => {
  it("answers 200 'ok' with the database up, and nothing but the status and the database flag", async () => {
    dbHealthCheck.mockResolvedValue({ ok: true, latencyMs: 7 });
    const { GET } = await import("../src/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", checks: { database: { ok: true } } });
    // version and latency are logged instead
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: "health.check", databaseOk: true, latencyMs: 7 }),
      "health.check",
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("answers 503 'degraded' with the database down, and logs only a short error class", async () => {
    dbHealthCheck.mockResolvedValue({ ok: false, latencyMs: 31, errorClass: "ECONNREFUSED" });
    const { GET } = await import("../src/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "degraded",
      checks: { database: { ok: false } },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ databaseOk: false, latencyMs: 31, errorClass: "ECONNREFUSED" }),
      "health.degraded",
    );
  });

  it("never puts the version or the latency in the public body", async () => {
    dbHealthCheck.mockResolvedValue({ ok: true, latencyMs: 123456 });
    const { GET } = await import("../src/app/api/health/route");
    const text = JSON.stringify(await (await GET()).json());
    expect(text).not.toContain("version");
    expect(text).not.toContain("latency");
    expect(text).not.toContain("123456");
  });
});
