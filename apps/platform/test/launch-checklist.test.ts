// The back-office's launch checklist (igs-pharma#238) with the delivery query faked: shown only to
// who may set the delivery amounts, reading those through the query (which checks again, D-005), and
// a failing read never breaks the page.
import type { ResolvedActor } from "@igs/auth";
import { useCodeRbacCatalogue } from "@igs/rbac/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = {
  getDeliverySettings: vi.fn(),
  logger: { error: vi.fn() },
};
vi.mock("@igs/module-orders", () => ({ getDeliverySettings: fakes.getDeliverySettings }));
vi.mock("@igs/observability/logger", () => ({ logger: fakes.logger }));

useCodeRbacCatalogue();

const load = async (member: ResolvedActor) =>
  (await import("../src/server/launch")).loadLaunchChecklist(member);

const actor = (role: string) =>
  ({
    type: "user",
    id: "0192f000-0000-7000-8000-0000000000aa",
    roles: [role],
    kind: "staff",
  }) as unknown as ResolvedActor;

beforeEach(() => {
  fakes.getDeliverySettings.mockReset();
  fakes.logger.error.mockReset();
  fakes.getDeliverySettings.mockResolvedValue({ isDefault: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("loadLaunchChecklist", () => {
  it("lists every launch check for the owner, the storefront's own settings marked as checked there", async () => {
    const readiness = await load(actor("owner"));
    expect(readiness?.checks).toHaveLength(16);
    const status = (id: string) => readiness?.checks.find((c) => c.id === id)?.status;
    expect(status("payments")).toBe("elsewhere");
    expect(status("shop_switches")).toBe("elsewhere");
    expect(status("pharmacy_details")).toBe("missing");
    expect(readiness?.ready).toBe(false);
    expect(fakes.getDeliverySettings).toHaveBeenCalledOnce();
  });

  it("is left out for a member who may not set the delivery amounts, without reading anything", async () => {
    expect(await load(actor("pharmacy_assistant"))).toBeUndefined();
    expect(fakes.getDeliverySettings).not.toHaveBeenCalled();
  });

  it("survives a failing delivery read and logs it", async () => {
    fakes.getDeliverySettings.mockRejectedValue(new Error("database is down"));
    const readiness = await load(actor("owner"));
    expect(readiness?.checks.length).toBe(16);
    expect(fakes.logger.error).toHaveBeenCalledOnce();
  });
});
