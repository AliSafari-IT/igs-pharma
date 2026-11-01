import {
  type MailSettings,
  type Mailer,
  type OrderMailTemplateName,
  mailerFromEnv,
} from "@igs/mail";
import type { MailSender } from "@igs/module-identity";
import type { OrderMailKind, OrderMailSender } from "@igs/module-orders";

/**
 * The worker's mail sender (igs-pharma#114): the identity module hands over a mail, this renders and
 * sends it through `@igs/mail`. The mailer is built on the first mail, so a worker without SMTP
 * settings still boots and runs its other jobs; the mail job then fails with `mail.not_configured`
 * and is retried (a delayed mail, never a lost one).
 */
export function createMailSender(settings: MailSettings, mailer?: Mailer): MailSender {
  let current = mailer;
  return async (mail) => {
    current ??= mailerFromEnv(settings);
    await current.send({
      to: mail.to,
      locale: mail.locale,
      template: mail.template,
      data: { name: mail.name, url: mail.url, validUntil: mail.validUntil },
    });
  };
}

/** The template of each order mail kind (igs-pharma#157). */
const ORDER_TEMPLATE: Record<OrderMailKind, OrderMailTemplateName> = {
  order_received: "order_received",
  stock_short: "order_stock_short",
  ready_for_pickup: "order_ready_for_pickup",
  shipped: "order_shipped",
  refund_initiated: "order_refund_initiated",
  refund_completed: "order_refund_completed",
  recall_notice: "order_recall_notice",
};

/** The worker's order mail sender (igs-pharma#157); built lazily like the account one. */
export function createOrderMailSender(settings: MailSettings, mailer?: Mailer): OrderMailSender {
  let current = mailer;
  return async (mail) => {
    current ??= mailerFromEnv(settings);
    await current.sendOrder({
      to: mail.to,
      locale: mail.locale,
      template: ORDER_TEMPLATE[mail.kind],
      data: {
        name: mail.name,
        reference: mail.reference,
        amountCents: mail.amountCents,
        trackingUrl: mail.trackingUrl,
      },
    });
  };
}
