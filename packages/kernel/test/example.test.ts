// The example from docs/06-engineering/kernel.md, executed. Keep both in sync.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { z } from "zod";

import { command } from "../src";
import { actors, configureKernelForTests, resetKernelForTests } from "../src/testing";

let iso: IsolatedDatabase;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
});
afterAll(async () => {
  await iso?.drop();
});
afterEach(() => resetKernelForTests());

const approveReview = command({
  name: "orders.review.approve",
  input: z.object({ orderId: z.string().min(1) }),
  output: z.object({ orderId: z.string(), status: z.string() }),
  permission: "orders.review.decide",
  async handler({ input, ctx }) {
    await ctx.audit.record({
      action: "pharmacy.review.decided",
      entityType: "order",
      entityId: input.orderId,
      data: { decision: "approved" },
    });
    return { orderId: input.orderId, status: "ready_for_fulfilment" };
  },
});

it("the documented example command runs, audits and is idempotent", async () => {
  const kernel = configureKernelForTests({ db: iso.db });
  const actor = actors.user({ roles: ["pharmacist"] });

  const result = await approveReview({ orderId: "o-1" }, actor, { idempotencyKey: "req-1" });
  expect(result).toEqual({ orderId: "o-1", status: "ready_for_fulfilment" });
  expect(kernel.inMemoryAudit.entries[0]?.action).toBe("pharmacy.review.decided");

  await approveReview({ orderId: "o-1" }, actor, { idempotencyKey: "req-1" });
  expect(kernel.inMemoryAudit.entries).toHaveLength(1); // replay: handler (and audit) not run again
});
