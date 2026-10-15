import { type MailSettings, type Mailer, mailerFromEnv } from "@igs/mail";
import type { MailSender } from "@igs/module-identity";

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
      data: { name: mail.name, url: mail.url },
    });
  };
}
