import { registeredTopics } from "@igs/kernel/testing";
import { MailRequested } from "@igs/module-identity";
import { OrderMailRequested, RefundRequested } from "@igs/module-orders";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Every outbox event a back-office command can queue must be registered by this app's composition
 * root: an unregistered one fails the command with `kernel.event_not_registered` AFTER the work was
 * done. That is how the early-access decisions failed on the first real run (igs-pharma#199): the
 * app registered the order events but not the identity mail event.
 */
describe("the back-office registers the outbox events its commands queue", () => {
  beforeAll(async () => {
    vi.stubEnv("AUDIT_HMAC_KEY", "x".repeat(32));
    const { ensureAuthConfigured } = await import("../src/server/kernel");
    ensureAuthConfigured();
  });

  it("knows the identity mail event (early-access approve, reject and revoke)", () => {
    expect(registeredTopics()).toContain(MailRequested.topic);
  });

  it("still knows the order events", () => {
    expect(registeredTopics()).toEqual(
      expect.arrayContaining([OrderMailRequested.topic, RefundRequested.topic]),
    );
  });
});
