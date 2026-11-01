import { describe, expect, it } from "vitest";

import {
  MAIL_LOCALES,
  type MailTransport,
  ORDER_MAIL_TEMPLATES,
  createMailer,
  renderOrderMail,
} from "./index";

const data = { name: "An", reference: "IGS-2026-000123", amountCents: 1_250 };

describe("renderOrderMail", () => {
  it("renders every order mail in every language, with the reference and nothing else of the order", () => {
    for (const template of ORDER_MAIL_TEMPLATES) {
      for (const locale of MAIL_LOCALES) {
        const mail = renderOrderMail(template, locale, data);
        expect(mail.subject, `${template}/${locale}`).toContain("IGS-2026-000123");
        expect(mail.text).toContain("IGS-Pharma");
        // no link without one given (the shipped mail's tracking link is tested below)
        expect(mail.text).not.toContain("http");
      }
    }
  });

  it("a payment received or a stock problem never says approved or ready (#157)", () => {
    // claims of approval, or that the order IS ready now (a promise to tell them later is fine)
    const approvedOrReady =
      /goedgekeurd|approuv|genehmigt|freigegeben|approved|ligt klaar|est prête|liegt (zur Abholung )?bereit|is ready/i;
    for (const template of ["order_received", "order_stock_short"] as const) {
      for (const locale of MAIL_LOCALES) {
        const { subject, text } = renderOrderMail(template, locale, data);
        expect(`${subject}\n${text}`, `${template}/${locale}`).not.toMatch(approvedOrReady);
      }
    }
  });

  it("the refund mails carry the amount from the record, in the mail's language", () => {
    expect(renderOrderMail("order_refund_initiated", "nl", data).text).toContain("€ 12,50");
    expect(renderOrderMail("order_refund_completed", "fr", data).text).toContain("12,50 €");
    expect(renderOrderMail("order_refund_initiated", "en", data).text).toContain("€12.50");
    expect(() =>
      renderOrderMail("order_refund_initiated", "nl", { name: "An", reference: "IGS-2026-000123" }),
    ).toThrow(/mail\.amount_missing/);
  });

  it("the shipped mail carries the carrier's https tracking link, and nothing else (#202)", () => {
    const url = "https://tracking.sendcloud.sc/forward?carrier=bpost&code=3232";
    for (const locale of MAIL_LOCALES) {
      const mail = renderOrderMail("order_shipped", locale, { ...data, trackingUrl: url });
      expect(mail.text).toContain(url);
      expect(mail.html).toContain(`href="${url.replace("&", "&amp;")}"`);
    }
    for (const bad of [
      "http://tracking.example/x",
      'https://x.example/"><script>',
      "javascript:x",
    ]) {
      const mail = renderOrderMail("order_shipped", "nl", { ...data, trackingUrl: bad });
      expect(mail.html).not.toContain("<a ");
      expect(mail.text).not.toContain(bad);
    }
    // the link is for the shipped mail only
    expect(
      renderOrderMail("order_ready_for_pickup", "nl", {
        ...data,
        trackingUrl: "https://x.example/",
      }).text,
    ).not.toContain("https://");
    expect(renderOrderMail("order_shipped", "en", data).subject).toBe(
      "Your order IGS-2026-000123 is on its way",
    );
  });

  it("escapes the name in the HTML and falls back to Dutch", () => {
    const mail = renderOrderMail("order_received", "xx", { ...data, name: "<b>An</b>\nX" });
    expect(mail.subject).toBe("We hebben uw bestelling IGS-2026-000123 ontvangen");
    expect(mail.html).toContain("&lt;b&gt;An&lt;/b&gt; X");
  });
});

describe("mailer.sendOrder", () => {
  it("renders and sends through the transport; refuses a bad address", async () => {
    const sent: { to: string; subject: string }[] = [];
    const transport: MailTransport = {
      async sendMail(message) {
        sent.push(message);
      },
    };
    const mailer = createMailer({ smtpUrl: "smtp://x", from: "IGS <no-reply@x.be>", transport });
    await mailer.sendOrder({
      to: "an@example.be",
      locale: "de",
      template: "order_ready_for_pickup",
      data,
    });
    expect(sent).toMatchObject([
      { to: "an@example.be", subject: "Ihre Bestellung IGS-2026-000123 liegt bereit" },
    ]);
    await expect(
      mailer.sendOrder({ to: "a@b.be, c@d.be", locale: "nl", template: "order_received", data }),
    ).rejects.toThrow(/mail\.address_invalid/);
  });
});
