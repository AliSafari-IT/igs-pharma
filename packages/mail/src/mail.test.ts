import { describe, expect, it, vi } from "vitest";

import {
  MAIL_LOCALES,
  MAIL_TEMPLATES,
  type MailTransport,
  createMailer,
  mailerFromEnv,
  renderMail,
} from "./index";

const URL_TEXT = "http://localhost:3000/api/auth/verify-email?token=T0K3N&callbackURL=%2F";

describe("renderMail", () => {
  it("renders every template in every language, with the link in both the text and the HTML", () => {
    for (const template of MAIL_TEMPLATES) {
      for (const locale of MAIL_LOCALES) {
        const mail = renderMail(template, locale, { name: "An", url: URL_TEXT });
        expect(mail.subject, `${template}/${locale}`).not.toBe("");
        expect(mail.text).toContain("IGS-Pharma");
        if (template !== "account_exists") {
          expect(mail.text).toContain(URL_TEXT);
          expect(mail.html).toContain("&amp;callbackURL=%2F"); // escaped inside the attribute
        } else {
          expect(mail.text).not.toContain("http");
        }
      }
    }
  });

  it("speaks the person's language and falls back to Dutch for an unknown one", () => {
    expect(renderMail("verify_email", "fr", { name: "An", url: URL_TEXT }).subject).toBe(
      "Confirmez votre adresse e-mail",
    );
    expect(renderMail("verify_email", "de", { name: "An", url: URL_TEXT }).subject).toContain(
      "Bestätigen",
    );
    expect(renderMail("verify_email", "en", { name: "An", url: URL_TEXT }).subject).toBe(
      "Confirm your e-mail address",
    );
    expect(renderMail("verify_email", "xx", { name: "An", url: URL_TEXT }).subject).toBe(
      "Bevestig uw e-mailadres",
    );
  });

  it("escapes the name and the link in the HTML and keeps a name on one line", () => {
    const mail = renderMail("reset_password", "en", {
      name: '<script>alert("x")</script>\nBcc: evil@example.com',
      url: 'http://x.test/?a=1&b="2"',
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("a=1&amp;b=&quot;2&quot;");
    // the plain text greets on ONE line (the name's line break became a space)
    expect(mail.text.split("\n")[0]).toBe(
      'Hello <script>alert("x")</script> Bcc: evil@example.com,',
    );
  });

  it("refuses a link template without a link: a mail with a missing link never goes out", () => {
    expect(() => renderMail("verify_email", "nl", { name: "An" })).toThrow(/mail\.link_missing/);
    expect(() => renderMail("reset_password", "nl", { name: "An" })).toThrow(/mail\.link_missing/);
    expect(() => renderMail("account_exists", "nl", { name: "An" })).not.toThrow();
  });
});

describe("createMailer", () => {
  const transport = () => {
    const sent: Parameters<MailTransport["sendMail"]>[0][] = [];
    const fake: MailTransport = {
      sendMail: vi.fn(async (message) => {
        sent.push(message);
      }),
    };
    return { sent, fake };
  };

  it("sends the rendered mail from the configured sender to the one address", async () => {
    const { sent, fake } = transport();
    const mailer = createMailer({
      smtpUrl: "smtp://localhost:1025",
      from: "IGS-Pharma <no-reply@example.test>",
      transport: fake,
    });
    await mailer.send({
      to: "an@example.test",
      locale: "nl",
      template: "verify_email",
      data: { name: "An", url: URL_TEXT },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: "IGS-Pharma <no-reply@example.test>",
      to: "an@example.test",
      subject: "Bevestig uw e-mailadres",
    });
    expect(sent[0]?.text).toContain(URL_TEXT);
  });

  it("refuses an address that could carry a second recipient or a header", async () => {
    const { sent, fake } = transport();
    const mailer = createMailer({ smtpUrl: "smtp://x", from: "a@b.test", transport: fake });
    for (const to of ["a@b.test, c@d.test", "a@b.test\r\nBcc: c@d.test", "<a@b.test>", "nobody"]) {
      await expect(
        mailer.send({ to, locale: "nl", template: "account_exists", data: { name: "An" } }),
        to,
      ).rejects.toThrow(/mail\.address_invalid/);
    }
    expect(sent).toEqual([]);
  });

  it("lets a transport failure through, so the job fails and is retried", async () => {
    const mailer = createMailer({
      smtpUrl: "smtp://x",
      from: "a@b.test",
      transport: {
        sendMail: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      },
    });
    await expect(
      mailer.send({
        to: "a@b.test",
        locale: "nl",
        template: "account_exists",
        data: { name: "An" },
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("mailerFromEnv", () => {
  it("fails closed without SMTP_URL or MAIL_FROM", () => {
    expect(() => mailerFromEnv({})).toThrow(/mail\.not_configured/);
    expect(() => mailerFromEnv({ SMTP_URL: "smtp://x" })).toThrow(/mail\.not_configured/);
    expect(() => mailerFromEnv({ MAIL_FROM: "a@b.test" })).toThrow(/mail\.not_configured/);
    expect(() => mailerFromEnv({ SMTP_URL: "smtp://x", MAIL_FROM: "a@b.test" })).not.toThrow();
  });
});
