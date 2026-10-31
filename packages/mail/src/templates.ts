/**
 * The account mails (igs-pharma#114, D-044): plain text plus a simple HTML version, in the four
 * storefront languages. No images, no tracking, no health information, and nothing but the link the
 * person needs. Pure functions: nothing here sends or reads the environment.
 */
export const MAIL_LOCALES = ["nl", "fr", "de", "en"] as const;
export type MailLocale = (typeof MAIL_LOCALES)[number];

export const MAIL_TEMPLATES = [
  "verify_email",
  "reset_password",
  "account_exists",
  // early access to the shop before launch (igs-pharma#199)
  "early_access_received",
  "early_access_approved",
  "early_access_rejected",
  "early_access_revoked",
  "early_access_staff_notice",
] as const;
export type MailTemplateName = (typeof MAIL_TEMPLATES)[number];

export interface MailData {
  /** The person's name, for the greeting. */
  readonly name: string;
  /** The link to follow; required by `verify_email` and `reset_password`, optional for early access. */
  readonly url?: string | undefined;
  /** The end of an early-access approval; absent = until the shop opens to everyone. */
  readonly validUntil?: Date | undefined;
}

export interface RenderedMail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

interface Copy {
  readonly subject: string;
  readonly greeting: (name: string) => string;
  /** The body; a function when it states a date (`until` is formatted, or `null` = until launch). */
  readonly lines: readonly string[] | ((until: string | null) => readonly string[]);
  /** Label of the link, when the template has one. */
  readonly action?: string;
  /** The link is shown when given, but the mail may go without it (early access). */
  readonly linkOptional?: true;
  readonly ignore: string;
  readonly signOff: string;
}

const GREET: Record<MailLocale, (name: string) => string> = {
  nl: (name) => `Dag ${name},`,
  fr: (name) => `Bonjour ${name},`,
  de: (name) => `Guten Tag ${name},`,
  en: (name) => `Hello ${name},`,
};
const SIGN: Record<MailLocale, string> = {
  nl: "Het team van IGS-Pharma",
  fr: "L'équipe d'IGS-Pharma",
  de: "Das Team von IGS-Pharma",
  en: "The IGS-Pharma team",
};
const SHOP_LINK: Record<MailLocale, string> = {
  nl: "Naar de webwinkel",
  fr: "Vers la boutique en ligne",
  de: "Zum Webshop",
  en: "Go to the webshop",
};
const STATUS_LINK: Record<MailLocale, string> = {
  nl: "Bekijk uw aanvraag",
  fr: "Voir votre demande",
  de: "Ihre Anfrage ansehen",
  en: "See your request",
};

const earlyAccess = (
  copy: Record<MailLocale, Pick<Copy, "subject" | "lines" | "ignore">>,
  link?: Record<MailLocale, string>,
): Record<MailLocale, Copy> => {
  const out = {} as Record<MailLocale, Copy>;
  for (const locale of MAIL_LOCALES) {
    out[locale] = {
      ...copy[locale],
      greeting: GREET[locale],
      signOff: SIGN[locale],
      ...(link ? { action: link[locale], linkOptional: true as const } : {}),
    };
  }
  return out;
};

/**
 * The early-access mails (igs-pharma#199). They say what happened and nothing more: never the note,
 * never a staff member's reason (the person reads that on their own page, signed in).
 */
const EARLY_ACCESS_COPY = {
  early_access_received: earlyAccess(
    {
      nl: {
        subject: "We hebben uw aanvraag voor vroege toegang ontvangen",
        lines: [
          "U vroeg om de webwinkel van IGS-Pharma te bekijken voor de officiële opening.",
          "Een medewerker bekijkt uw aanvraag. U krijgt een e-mail zodra er een beslissing is.",
        ],
        ignore: "Heeft u dit niet zelf gevraagd? Neem dan contact op met de apotheek.",
      },
      fr: {
        subject: "Nous avons reçu votre demande d'accès anticipé",
        lines: [
          "Vous avez demandé à voir la boutique en ligne d'IGS-Pharma avant son ouverture officielle.",
          "Un membre de l'équipe examine votre demande. Vous recevrez un e-mail dès qu'une décision sera prise.",
        ],
        ignore: "Vous n'êtes pas à l'origine de cette demande ? Contactez la pharmacie.",
      },
      de: {
        subject: "Wir haben Ihre Anfrage für den frühen Zugang erhalten",
        lines: [
          "Sie haben gebeten, den Webshop von IGS-Pharma vor der offiziellen Eröffnung zu sehen.",
          "Ein Mitarbeiter prüft Ihre Anfrage. Sie erhalten eine E-Mail, sobald eine Entscheidung gefallen ist.",
        ],
        ignore: "Sie haben das nicht selbst veranlasst? Wenden Sie sich bitte an die Apotheke.",
      },
      en: {
        subject: "We received your early access request",
        lines: [
          "You asked to see the IGS-Pharma webshop before it officially opens.",
          "A member of staff will look at your request. You will get an e-mail once it has been decided.",
        ],
        ignore: "Did not ask for this? Please contact the pharmacy.",
      },
    },
    STATUS_LINK,
  ),
  early_access_approved: earlyAccess(
    {
      nl: {
        subject: "U heeft vroege toegang tot de webwinkel",
        lines: (until) => [
          "Uw aanvraag is goedgekeurd: u kunt de webwinkel van IGS-Pharma nu al bekijken.",
          until
            ? `Meld u aan met uw account. De toegang loopt tot ${until}.`
            : "Meld u aan met uw account. De toegang loopt tot de webwinkel voor iedereen opengaat.",
        ],
        ignore: "Heeft u dit niet zelf gevraagd? Neem dan contact op met de apotheek.",
      },
      fr: {
        subject: "Vous avez un accès anticipé à la boutique en ligne",
        lines: (until) => [
          "Votre demande a été acceptée : vous pouvez déjà voir la boutique en ligne d'IGS-Pharma.",
          until
            ? `Connectez-vous avec votre compte. L'accès est valable jusqu'au ${until}.`
            : "Connectez-vous avec votre compte. L'accès est valable jusqu'à l'ouverture de la boutique à tous.",
        ],
        ignore: "Vous n'êtes pas à l'origine de cette demande ? Contactez la pharmacie.",
      },
      de: {
        subject: "Sie haben frühen Zugang zum Webshop",
        lines: (until) => [
          "Ihre Anfrage wurde angenommen: Sie können den Webshop von IGS-Pharma schon jetzt sehen.",
          until
            ? `Melden Sie sich mit Ihrem Konto an. Der Zugang gilt bis zum ${until}.`
            : "Melden Sie sich mit Ihrem Konto an. Der Zugang gilt, bis der Webshop für alle öffnet.",
        ],
        ignore: "Sie haben das nicht selbst veranlasst? Wenden Sie sich bitte an die Apotheke.",
      },
      en: {
        subject: "You have early access to the webshop",
        lines: (until) => [
          "Your request was approved: you can see the IGS-Pharma webshop already.",
          until
            ? `Sign in with your account. Your access lasts until ${until}.`
            : "Sign in with your account. Your access lasts until the webshop opens to everyone.",
        ],
        ignore: "Did not ask for this? Please contact the pharmacy.",
      },
    },
    SHOP_LINK,
  ),
  early_access_rejected: earlyAccess(
    {
      nl: {
        subject: "Uw aanvraag voor vroege toegang",
        lines: [
          "Uw aanvraag om de webwinkel van IGS-Pharma voor de opening te bekijken, werd niet goedgekeurd.",
          "Meld u aan op de webwinkel om de toelichting te lezen. U bent welkom zodra de webwinkel voor iedereen opengaat.",
        ],
        ignore: "Heeft u dit niet zelf gevraagd? Dan kunt u deze e-mail negeren.",
      },
      fr: {
        subject: "Votre demande d'accès anticipé",
        lines: [
          "Votre demande de voir la boutique en ligne d'IGS-Pharma avant son ouverture n'a pas été acceptée.",
          "Connectez-vous sur la boutique pour lire l'explication. Vous êtes le bienvenu dès que la boutique ouvre à tous.",
        ],
        ignore: "Vous n'êtes pas à l'origine de cette demande ? Vous pouvez ignorer cet e-mail.",
      },
      de: {
        subject: "Ihre Anfrage für den frühen Zugang",
        lines: [
          "Ihre Anfrage, den Webshop von IGS-Pharma vor der Eröffnung zu sehen, wurde nicht angenommen.",
          "Melden Sie sich im Webshop an, um die Erläuterung zu lesen. Sie sind willkommen, sobald der Webshop für alle öffnet.",
        ],
        ignore: "Sie haben das nicht selbst veranlasst? Dann können Sie diese E-Mail ignorieren.",
      },
      en: {
        subject: "Your early access request",
        lines: [
          "Your request to see the IGS-Pharma webshop before it opens was not approved.",
          "Sign in on the webshop to read why. You are welcome as soon as the webshop opens to everyone.",
        ],
        ignore: "Did not ask for this? You can ignore this e-mail.",
      },
    },
    STATUS_LINK,
  ),
  early_access_revoked: earlyAccess(
    {
      nl: {
        subject: "Uw vroege toegang tot de webwinkel is beëindigd",
        lines: [
          "Uw vroege toegang tot de webwinkel van IGS-Pharma werd beëindigd. Binnen een kwartier ziet u de pagina 'Binnenkort geopend'.",
          "Meld u aan op de webwinkel om de toelichting te lezen. Uw account en uw bestellingen blijven bewaard.",
        ],
        ignore: "Vragen? Neem contact op met de apotheek.",
      },
      fr: {
        subject: "Votre accès anticipé à la boutique a pris fin",
        lines: [
          "Votre accès anticipé à la boutique en ligne d'IGS-Pharma a pris fin. D'ici un quart d'heure, vous verrez la page « Bientôt ouvert ».",
          "Connectez-vous sur la boutique pour lire l'explication. Votre compte et vos commandes sont conservés.",
        ],
        ignore: "Des questions ? Contactez la pharmacie.",
      },
      de: {
        subject: "Ihr früher Zugang zum Webshop wurde beendet",
        lines: [
          "Ihr früher Zugang zum Webshop von IGS-Pharma wurde beendet. Innerhalb einer Viertelstunde sehen Sie die Seite „Bald geöffnet“.",
          "Melden Sie sich im Webshop an, um die Erläuterung zu lesen. Ihr Konto und Ihre Bestellungen bleiben erhalten.",
        ],
        ignore: "Fragen? Wenden Sie sich bitte an die Apotheke.",
      },
      en: {
        subject: "Your early access to the webshop has ended",
        lines: [
          "Your early access to the IGS-Pharma webshop has ended. Within a quarter of an hour you will see the 'Opening soon' page.",
          "Sign in on the webshop to read why. Your account and your orders are kept.",
        ],
        ignore: "Questions? Please contact the pharmacy.",
      },
    },
    STATUS_LINK,
  ),
  // to staff (always rendered in English, like the back-office); it names nobody
  early_access_staff_notice: earlyAccess({
    nl: {
      subject: "Nieuwe aanvraag voor vroege toegang",
      lines: [
        "Er wacht een nieuwe aanvraag voor vroege toegang tot de webwinkel.",
        "Open 'Early access' in de back-office om ze te bekijken.",
      ],
      ignore: "U krijgt deze e-mail omdat uw adres op de meldingslijst voor vroege toegang staat.",
    },
    fr: {
      subject: "Nouvelle demande d'accès anticipé",
      lines: [
        "Une nouvelle demande d'accès anticipé à la boutique en ligne attend une décision.",
        "Ouvrez « Early access » dans le back-office pour la voir.",
      ],
      ignore:
        "Vous recevez cet e-mail parce que votre adresse figure sur la liste de notification de l'accès anticipé.",
    },
    de: {
      subject: "Neue Anfrage für den frühen Zugang",
      lines: [
        "Eine neue Anfrage für den frühen Zugang zum Webshop wartet auf eine Entscheidung.",
        "Öffnen Sie „Early access“ im Back-Office, um sie anzusehen.",
      ],
      ignore:
        "Sie erhalten diese E-Mail, weil Ihre Adresse auf der Benachrichtigungsliste für den frühen Zugang steht.",
    },
    en: {
      subject: "New early access request",
      lines: [
        "A new request for early access to the webshop is waiting for a decision.",
        "Open 'Early access' in the back-office to see it.",
      ],
      ignore: "You get this e-mail because your address is on the early access notification list.",
    },
  }),
} satisfies Record<string, Record<MailLocale, Copy>>;

const COPY: Record<MailTemplateName, Record<MailLocale, Copy>> = {
  ...EARLY_ACCESS_COPY,
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

/** A date as the person reads it: "31 oktober 2026", in Brussels time. */
function formatDate(date: Date, locale: MailLocale): string {
  return new Intl.DateTimeFormat(`${locale}-BE`, {
    dateStyle: "long",
    timeZone: "Europe/Brussels",
  }).format(date);
}

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
  const language = isMailLocale(locale) ? locale : "nl";
  const copy = COPY[template][language];
  if (copy.action && !copy.linkOptional && !data.url) {
    throw new Error(`mail.link_missing: template ${template}`);
  }
  const lines =
    typeof copy.lines === "function"
      ? copy.lines(data.validUntil ? formatDate(data.validUntil, language) : null)
      : copy.lines;
  const name = oneLine(data.name) || "";
  const greeting = copy.greeting(name).replace(/\s+,/, ",");

  const text = [
    greeting,
    "",
    ...lines.flatMap((line) => [line, ""]),
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
    ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    ...(copy.action && data.url
      ? [`<p><a href="${escapeHtml(data.url)}">${escapeHtml(copy.action)}</a></p>`]
      : []),
    `<p>${escapeHtml(copy.ignore)}</p>`,
    `<p>${escapeHtml(copy.signOff)}</p>`,
    "</body></html>",
  ].join("\n");

  return { subject: copy.subject, text, html };
}
