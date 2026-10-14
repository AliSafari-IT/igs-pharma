import { MAIL_TEMPLATES, type Mailer } from "@igs/mail";
import { describe, expect, it, vi } from "vitest";

import { createMailSender } from "../src/mail-sender";

const mail = {
  to: "an@example.test",
  name: "An",
  locale: "en",
  template: MAIL_TEMPLATES[0],
  url: "http://localhost:3000/x",
} as const;

describe("createMailSender", () => {
  it("hands the mail to the mailer in the shape @igs/mail expects", async () => {
    const send = vi.fn(async () => {});
    const sender = createMailSender({}, { send } as Mailer);
    await sender(mail);
    expect(send).toHaveBeenCalledWith({
      to: "an@example.test",
      locale: "en",
      template: "verify_email",
      data: { name: "An", url: "http://localhost:3000/x" },
    });
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
