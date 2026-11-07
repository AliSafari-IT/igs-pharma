// The storefront's launch gate (igs-pharma#238): loud when it refuses to open, or when the shop is
// open while launch items are missing; once per state, never per request.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logger = { error: vi.fn(), info: vi.fn() };
vi.mock("@igs/observability/logger", () => ({ logger }));

beforeEach(() => {
  vi.resetModules();
  logger.error.mockReset();
  logger.info.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const gate = async () => (await import("../src/launch-gate")).currentStorefrontGate;

describe("currentStorefrontGate", () => {
  it("logs one error naming the missing checks when SITE_GATE=off is refused", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_GATE", "off");
    vi.stubEnv("LAUNCH_CHECK", "");
    const current = await gate();
    expect(current().closed).toBe(true);
    current();
    current();
    expect(logger.error).toHaveBeenCalledOnce();
    const [fields] = logger.error.mock.calls[0] ?? [];
    expect(fields).toMatchObject({ event: "launch.open_refused" });
    expect(fields.missing).toContain("pharmacy_details");
    expect(fields.missing).toContain("payments");
  });

  it("logs an error when the shop is open with items missing (LAUNCH_CHECK=report)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_GATE", "off");
    vi.stubEnv("LAUNCH_CHECK", "report");
    const current = await gate();
    expect(current().closed).toBe(false);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0]?.[0]).toMatchObject({ event: "launch.open_not_ready" });
  });

  it("only notes the missing items while the gate is closed on purpose", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_GATE", "coming-soon");
    const current = await gate();
    expect(current()).toMatchObject({ closed: true, refused: false });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledOnce();
  });
});
