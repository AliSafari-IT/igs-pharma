/**
 * The account mails (igs-pharma#114, D-044): plain text plus a simple HTML version, in the four
 * storefront languages. No images, no tracking, no health information, and nothing but the link the
 * person needs. Pure functions: nothing here sends or reads the environment.
 */
export const MAIL_LOCALES = ["nl", "fr", "de", "en"] as const;
export type MailLocale = (typeof MAIL_LOCALES)[number];

export const MAIL_TEMPLATES = ["verify_email", "reset_password", "account_exists"] as const;
export type MailTemplateName = (typeof MAIL_TEMPLATES)[number];

export interface MailData {
  /** The person's name, for the greeting. */
  readonly name: string;
  /** The link to follow; required by `verify_email` and `reset_password`. */
  readonly url?: string | undefined;
}

export interface RenderedMail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

interface Copy {
  readonly subject: string;
  readonly greeting: (name: string) => string;
  readonly lines: readonly string[];
  /** Label of the link, when the template has one. */
  readonly action?: string;
  readonly ignore: string;
  readonly signOff: string;
}

const COPY: Record<MailTemplateName, Record<MailLocale, Copy>> = {
  verify_email: {
    nl: {
      subject: "Bevestig uw e-mailadres",
      greeting: (name) => `Dag ${name},`,
      lines: [
        "Bedankt voor het aanmaken van uw account bij IGS-Pharma.",
        "Bevestig uw e-mailadres met de onderstaande link. De link is 24 uur geldig.",
      ],
      action: "E-mailadres bevestigen",
      ignore: "Heeft u dit niet zelf gevraagd? Dan kunt u deze e-mail negeren.",
      signOff: "Het team van IGS-Pharma",
    },
    fr: {
      subject: "Confirmez votre adresse e-mail",
      greeting: (name) => `Bonjour ${name},`,
      lines: [
        "Merci d'avoir créé votre compte chez IGS-Pharma.",
        "Confirmez votre adresse e-mail avec le lien ci-dessous. Le lien est valable 24 heures.",
      ],
      action: "Confirmer l'adresse e-mail",
      ignore: "Vous n'êtes pas à l'origine de cette demande ? Vous pouvez ignorer cet e-mail.",
      signOff: "L'équipe d'IGS-Pharma",
    },
    de: {
      subject: "Bestätigen Sie Ihre E-Mail-Adresse",
      greeting: (name) => `Guten Tag ${name},`,
      lines: [
        "Vielen Dank für die Erstellung Ihres Kontos bei IGS-Pharma.",
        "Bestätigen Sie Ihre E-Mail-Adresse über den folgenden Link. Der Link ist 24 Stunden gültig.",
      ],
      action: "E-Mail-Adresse bestätigen",
      ignore: "Sie haben das nicht selbst veranlasst? Dann können Sie diese E-Mail ignorieren.",
      signOff: "Das Team von IGS-Pharma",
    },
    en: {
      subject: "Confirm your e-mail address",
      greeting: (name) => `Hello ${name},`,
      lines: [
        "Thank you for creating your IGS-Pharma account.",
        "Confirm your e-mail address with the link below. The link is valid for 24 hours.",
      ],
      action: "Confirm e-mail address",
      ignore: "Did not ask for this? You can ignore this e-mail.",
      signOff: "The IGS-Pharma team",
    },
  },
  reset_password: {
    nl: {
      subject: "Stel een nieuw wachtwoord in",
      greeting: (name) => `Dag ${name},`,
      lines: [
        "Er werd gevraagd om het wachtwoord van uw IGS-Pharma-account opnieuw in te stellen.",
        "Kies een nieuw wachtwoord met de onderstaande link. De link is 1 uur geldig.",
      ],
      action: "Nieuw wachtwoord kiezen",
      ignore:
        "Heeft u dit niet zelf gevraagd? Negeer deze e-mail: uw wachtwoord blijft ongewijzigd.",
      signOff: "Het team van IGS-Pharma",
    },
    fr: {
      subject: "Choisissez un nouveau mot de passe",
      greeting: (name) => `Bonjour ${name},`,
      lines: [
        "La réinitialisation du mot de passe de votre compte IGS-Pharma a été demandée.",
        "Choisissez un nouveau mot de passe avec le lien ci-dessous. Le lien est valable 1 heure.",
      ],
      action: "Choisir un nouveau mot de passe",
      ignore:
        "Vous n'êtes pas à l'origine de cette demande ? Ignorez cet e-mail : votre mot de passe reste inchangé.",
      signOff: "L'équipe d'IGS-Pharma",
    },
    de: {
      subject: "Neues Passwort festlegen",
      greeting: (name) => `Guten Tag ${name},`,
      lines: [
        "Für Ihr IGS-Pharma-Konto wurde das Zurücksetzen des Passworts angefordert.",
        "Legen Sie über den folgenden Link ein neues Passwort fest. Der Link ist 1 Stunde gültig.",
      ],
      action: "Neues Passwort festlegen",
      ignore:
        "Sie haben das nicht selbst veranlasst? Ignorieren Sie diese E-Mail: Ihr Passwort bleibt unverändert.",
      signOff: "Das Team von IGS-Pharma",
    },
    en: {
      subject: "Choose a new password",
      greeting: (name) => `Hello ${name},`,
      lines: [
        "A password reset was requested for your IGS-Pharma account.",
        "Choose a new password with the link below. The link is valid for 1 hour.",
      ],
      action: "Choose a new password",
      ignore: "Did not ask for this? Ignore this e-mail: your password stays as it is.",
      signOff: "The IGS-Pharma team",
    },
  },
  account_exists: {
    nl: {
      subject: "U heeft al een account",
      greeting: (name) => `Dag ${name},`,
      lines: [
        "Iemand probeerde een account aan te maken met dit e-mailadres, maar u heeft al een account bij IGS-Pharma.",
        "Was u dat zelf? Meld u dan aan op de webwinkel, of kies 'Wachtwoord vergeten' als u uw wachtwoord niet meer weet.",
      ],
      ignore: "Was u dat niet? Dan hoeft u niets te doen: er werd niets gewijzigd.",
      signOff: "Het team van IGS-Pharma",
    },
    fr: {
      subject: "Vous avez déjà un compte",
      greeting: (name) => `Bonjour ${name},`,
      lines: [
        "Quelqu'un a essayé de créer un compte avec cette adresse e-mail, mais vous avez déjà un compte chez IGS-Pharma.",
        "C'était vous ? Connectez-vous sur la boutique en ligne, ou choisissez « Mot de passe oublié » si vous ne vous en souvenez plus.",
      ],
      ignore: "Ce n'était pas vous ? Vous n'avez rien à faire : rien n'a été modifié.",
      signOff: "L'équipe d'IGS-Pharma",
    },
    de: {
      subject: "Sie haben bereits ein Konto",
      greeting: (name) => `Guten Tag ${name},`,
      lines: [
        "Jemand hat versucht, mit dieser E-Mail-Adresse ein Konto zu erstellen, aber Sie haben bereits ein Konto bei IGS-Pharma.",
        "Waren Sie das? Melden Sie sich im Webshop an oder wählen Sie „Passwort vergessen“, falls Sie Ihr Passwort nicht mehr wissen.",
      ],
      ignore: "Waren Sie das nicht? Dann müssen Sie nichts tun: Es wurde nichts geändert.",
      signOff: "Das Team von IGS-Pharma",
    },
    en: {
      subject: "You already have an account",
      greeting: (name) => `Hello ${name},`,
      lines: [
        "Someone tried to create an account with this e-mail address, but you already have an IGS-Pharma account.",
        "Was that you? Sign in on the webshop, or choose “Forgot password” if you no longer know your password.",
      ],
      ignore: "Was it not you? You do not need to do anything: nothing was changed.",
      signOff: "The IGS-Pharma team",
    },
  },
};

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** Strips line breaks from a header-ish value (a name never starts a new line in the greeting). */
const oneLine = (value: string): string => value.replace(/[\r\n]+/g, " ").trim();

export const isMailLocale = (value: string): value is MailLocale =>
  (MAIL_LOCALES as readonly string[]).includes(value);

/**
 * The subject, plain text and HTML of one mail. An unknown locale falls back to Dutch (the default
 * language of the shop). A template that needs a link throws without one: a mail with a missing link
 * must never go out.
 */
export function renderMail(
  template: MailTemplateName,
  locale: string,
  data: MailData,
): RenderedMail {
  const copy = COPY[template][isMailLocale(locale) ? locale : "nl"];
  if (copy.action && !data.url) throw new Error(`mail.link_missing: template ${template}`);
  const name = oneLine(data.name) || "";
  const greeting = copy.greeting(name).replace(/\s+,/, ",");

  const text = [
    greeting,
    "",
    ...copy.lines.flatMap((line) => [line, ""]),
    ...(copy.action && data.url ? [`${copy.action}: ${data.url}`, ""] : []),
    copy.ignore,
    "",
    copy.signOff,
    "",
  ].join("\n");

  const html = [
    "<!doctype html>",
    '<html><body style="font-family: Arial, Helvetica, sans-serif; line-height: 1.5; color: #1a1a1a;">',
    `<p>${escapeHtml(greeting)}</p>`,
    ...copy.lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    ...(copy.action && data.url
      ? [`<p><a href="${escapeHtml(data.url)}">${escapeHtml(copy.action)}</a></p>`]
      : []),
    `<p>${escapeHtml(copy.ignore)}</p>`,
    `<p>${escapeHtml(copy.signOff)}</p>`,
    "</body></html>",
  ].join("\n");

  return { subject: copy.subject, text, html };
}
