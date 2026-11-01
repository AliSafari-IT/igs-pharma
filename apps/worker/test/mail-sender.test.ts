import { MAIL_TEMPLATES, type Mailer } from "@igs/mail";
import { describe, expect, it, vi } from "vitest";

import { createMailSender, createOrderMailSender } from "../src/mail-sender";

const mail = {
  to: "an@example.test",
  name: "An",
  locale: "en",
  template: MAIL_TEMPLATES[0],
  url: "http://localhost:3000/x",
  validUntil: undefined,
} as const;

describe("createMailSender", () => {
  it("hands the mail to the mailer in the shape @igs/mail expects", async () => {
    const send = vi.fn(async () => {});
    const sender = createMailSender({}, { send, sendOrder: vi.fn() } as Mailer);
    await sender(mail);
    expect(send).toHaveBeenCalledWith({
      to: "an@example.test",
      locale: "en",
      template: "verify_email",
      data: { name: "An", url: "http://localhost:3000/x", validUntil: undefined },
    });
  });

  it("passes the end date of an early-access approval (#199)", async () => {
    const send = vi.fn(async () => {});
    const sender = createMailSender({}, { send, sendOrder: vi.fn() } as Mailer);
    const until = new Date("2026-12-01T10:00:00Z");
    await sender({ ...mail, template: "early_access_approved", validUntil: until });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "early_access_approved",
        data: { name: "An", url: "http://localhost:3000/x", validUntil: until },
      }),
    );
  });

  it("without SMTP settings the worker still boots; the first mail fails and is retried", async () => {
    const sender = createMailSender({});
    await expect(sender(mail)).rejects.toThrow(/mail\.not_configured/);
  });

  it("builds the mailer once, on the first mail", async () => {
    const sender = createMailSender({ SMTP_URL: "smtp://localhost:1", MAIL_FROM: "a@b.test" });
    // nothing connects until a mail is sent; the first send fails to connect, not to configure
    await expect(sender(mail)).rejects.not.toThrow(/mail\.not_configured/);
  });
});

describe("createOrderMailSender (#157)", () => {
  it("maps each kind to its template and passes the reference and amount", async () => {
    const sendOrder = vi.fn(async () => {});
    const sender = createOrderMailSender({}, { send: vi.fn(), sendOrder } as Mailer);
    await sender({
      to: "an@example.be",
      name: "An",
      locale: "fr",
      kind: "refund_initiated",
      reference: "IGS-2026-000123",
      amountCents: 1_250,
      trackingUrl: undefined,
    });
    await sender({
      to: "an@example.be",
      name: "An",
      locale: "nl",
      kind: "ready_for_pickup",
      reference: "IGS-2026-000123",
      amountCents: undefined,
      trackingUrl: undefined,
    });
    await sender({
      to: "an@example.be",
      name: "An",
      locale: "en",
      kind: "shipped",
      reference: "IGS-2026-000123",
      amountCents: undefined,
      trackingUrl: "https://tracking.example/1",
    });
    expect(sendOrder.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      {
        to: "an@example.be",
        locale: "fr",
        template: "order_refund_initiated",
        data: {
          name: "An",
          reference: "IGS-2026-000123",
          amountCents: 1_250,
          trackingUrl: undefined,
        },
      },
      {
        to: "an@example.be",
        locale: "nl",
        template: "order_ready_for_pickup",
        data: {
          name: "An",
          reference: "IGS-2026-000123",
          amountCents: undefined,
          trackingUrl: undefined,
        },
      },
      {
        to: "an@example.be",
        locale: "en",
        template: "order_shipped",
        data: {
          name: "An",
          reference: "IGS-2026-000123",
          amountCents: undefined,
          trackingUrl: "https://tracking.example/1",
        },
      },
    ]);
  });
});
