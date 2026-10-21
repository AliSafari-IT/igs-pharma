import { createTransport } from "nodemailer";

import { type OrderMailData, type OrderMailTemplateName, renderOrderMail } from "./order-templates";
import { type MailData, type MailTemplateName, type RenderedMail, renderMail } from "./templates";

export {
  MAIL_LOCALES,
  MAIL_TEMPLATES,
  type MailData,
  type MailLocale,
  type MailTemplateName,
  type RenderedMail,
  isMailLocale,
  renderMail,
} from "./templates";
export {
  ORDER_MAIL_TEMPLATES,
  type OrderMailData,
  type OrderMailTemplateName,
  formatAmount,
  isOrderMailTemplate,
  renderOrderMail,
} from "./order-templates";

/**
 * Account mail over SMTP (igs-pharma#114, D-044). THE only place that talks to a mail server, and
 * only the worker imports it (the boundaries rule enforces it): a request never sends mail (D-019).
 *
 * Nothing here logs an address, a name or a link, and the result carries none of them.
 */
export interface SendMailInput {
  readonly to: string;
  readonly locale: string;
  readonly template: MailTemplateName;
  readonly data: MailData;
}

/** The slice of a nodemailer transport the mailer uses (a fake in tests). */
export interface MailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

/** An order mail (igs-pharma#157). */
export interface SendOrderMailInput {
  readonly to: string;
  readonly locale: string;
  readonly template: OrderMailTemplateName;
  readonly data: OrderMailData;
}

export interface Mailer {
  send(input: SendMailInput): Promise<void>;
  sendOrder(input: SendOrderMailInput): Promise<void>;
}

export interface MailerOptions {
  /** `smtp://host:port` or `smtps://user:pass@host:port`. */
  readonly smtpUrl: string;
  /** The From header, e.g. `IGS-Pharma <no-reply@example.be>`. */
  readonly from: string;
  /** A replacement transport, for tests. */
  readonly transport?: MailTransport;
}

/** A single address: no line breaks, no list, nothing a header could be injected through. */
const ADDRESS = /^[^\s<>,;"\\]+@[^\s<>,;"\\]+$/;

export function createMailer(options: MailerOptions): Mailer {
  const transport: MailTransport = options.transport ?? createTransport(options.smtpUrl);
  const deliver = async (to: string, { subject, text, html }: RenderedMail) => {
    if (!ADDRESS.test(to)) throw new Error("mail.address_invalid");
    await transport.sendMail({ from: options.from, to, subject, text, html });
  };
  return {
    send: ({ to, locale, template, data }) => deliver(to, renderMail(template, locale, data)),
    sendOrder: ({ to, locale, template, data }) =>
      deliver(to, renderOrderMail(template, locale, data)),
  };
}

export interface MailSettings {
  readonly SMTP_URL?: string | undefined;
  readonly MAIL_FROM?: string | undefined;
}

/**
 * The mailer for the configured SMTP server. Throws `mail.not_configured` when `SMTP_URL` or
 * `MAIL_FROM` is missing: the job that tried fails and is retried, so a mail is delayed, never lost
 * and never "sent" to nowhere.
 */
export function mailerFromEnv(settings: MailSettings): Mailer {
  if (!settings.SMTP_URL || !settings.MAIL_FROM) {
    throw new Error("mail.not_configured: set SMTP_URL and MAIL_FROM");
  }
  return createMailer({ smtpUrl: settings.SMTP_URL, from: settings.MAIL_FROM });
}

/** Renders and sends one mail through `mailer`. */
export function sendMail(mailer: Mailer, input: SendMailInput): Promise<void> {
  return mailer.send(input);
}
