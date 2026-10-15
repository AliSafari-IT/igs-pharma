// The dashboard loader (igs-pharma#115) with the module queries faked: the stock alerts and active
// reservations tiles come from ONE stock summary read, fail together on their own, and are left
// out for a member without the stock permission.
import type { ResolvedActor } from "@igs/auth";
import { useCodeRbacCatalogue } from "@igs/rbac/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = {
  getProductCounts: vi.fn(),
  getStockSummary: vi.fn(),
  listDsr: vi.fn(),
  logger: { error: vi.fn() },
};
vi.mock("@igs/module-catalog", () => ({ getProductCounts: fakes.getProductCounts }));
vi.mock("@igs/module-inventory", () => ({ getStockSummary: fakes.getStockSummary }));
vi.mock("@igs/module-privacy", () => ({ listDsr: fakes.listDsr }));
vi.mock("@igs/observability/logger", () => ({ logger: fakes.logger }));

useCodeRbacCatalogue();

const loadDashboard = async (member: ResolvedActor) =>
  (await import("../src/server/dashboard")).loadDashboard(member);

const actor = (role: string) =>
  ({
    type: "user",
    id: "0192f000-0000-7000-8000-0000000000aa",
    roles: [role],
    kind: "staff",
  }) as unknown as ResolvedActor;

beforeEach(() => {
  for (const fake of [fakes.getProductCounts, fakes.getStockSummary, fakes.listDsr]) {
    fake.mockReset();
  }
  fakes.logger.error.mockReset();
  fakes.getProductCounts.mockResolvedValue({ active: 4, draft: 1, awaitingApproval: 0 });
  fakes.listDsr.mockResolvedValue({ items: [], total: 0, overdueTotal: 0 });
});

describe("loadDashboard", () => {
  it("fills the stock alerts and active reservations tiles from one stock summary", async () => {
    fakes.getStockSummary.mockResolvedValue({ low: 2, out: 5, activeReservations: 7 });
    const owner = actor("owner");
    const dashboard = await loadDashboard(owner);
    expect(fakes.getStockSummary).toHaveBeenCalledTimes(1);
    expect(fakes.getStockSummary).toHaveBeenCalledWith({}, owner);
    expect(dashboard.stock).toEqual({ state: "ok", data: { low: 2, out: 5 } });
    expect(dashboard.reservations).toEqual({ state: "ok", data: { active: 7 } });
  });

  it("a failing summary puts both tiles in their error state, logs once, and leaves the others", async () => {
    fakes.getStockSummary.mockRejectedValue(new Error("database is down"));
    const dashboard = await loadDashboard(actor("owner"));
    expect(dashboard.stock).toEqual({ state: "error" });
    expect(dashboard.reservations).toEqual({ state: "error" });
    expect(dashboard.products).toEqual({
      state: "ok",
      data: { active: 4, draft: 1, awaitingApproval: 0 },
    });
    expect(fakes.logger.error).toHaveBeenCalledTimes(1);
    expect(fakes.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "platform.dashboard_tile_failed", tile: "stock" }),
      "dashboard tile failed",
    );
  });

  it("leaves both tiles out, and does not read stock, for a member without the stock permission", async () => {
    const dashboard = await loadDashboard(actor("content_editor"));
    expect(fakes.getStockSummary).not.toHaveBeenCalled();
    expect(dashboard).not.toHaveProperty("stock");
    expect(dashboard).not.toHaveProperty("reservations");
    expect(dashboard.products?.state).toBe("ok");
  });
});
