/**
 * The order mails (igs-pharma#157): one per order state the customer must know about, in the four
 * storefront languages. Each says only what that state means: a payment received is not a
 * pharmacist's approval, nor stock confirmed, nor an order ready. The order reference and, for a
 * refund, its amount are the only order data; never a product name or anything medical.
 * Pure functions: nothing here sends or reads the environment.
 */
import { type MailLocale, isMailLocale } from "./templates";

export const ORDER_MAIL_TEMPLATES = [
  "order_received",
  "order_stock_short",
  "order_ready_for_pickup",
  "order_shipped",
  "order_refund_initiated",
  "order_refund_completed",
  "order_recall_notice",
] as const;
export type OrderMailTemplateName = (typeof ORDER_MAIL_TEMPLATES)[number];

export interface OrderMailData {
  /** The contact's name, for the greeting. */
  readonly name: string;
  /** The order reference, `IGS-2026-000123`. */
  readonly reference: string;
  /** The refund's amount in cents; required by the refund templates. */
  readonly amountCents?: number | undefined;
  /**
   * The carrier's tracking link, for `order_shipped` (igs-pharma#202). https only; without one the
   * mail still goes out and says the order is on its way.
   */
  readonly trackingUrl?: string | undefined;
}

interface Copy {
  readonly subject: (reference: string) => string;
  readonly lines: (reference: string, amount: string) => readonly string[];
}

const NEEDS_AMOUNT: readonly OrderMailTemplateName[] = [
  "order_refund_initiated",
  "order_refund_completed",
];

const GREETING: Record<MailLocale, (name: string) => string> = {
  nl: (name) => `Dag ${name},`,
  fr: (name) => `Bonjour ${name},`,
  de: (name) => `Guten Tag ${name},`,
  en: (name) => `Hello ${name},`,
};

const SIGN_OFF: Record<MailLocale, string> = {
  nl: "Het team van IGS-Pharma",
  fr: "L'équipe d'IGS-Pharma",
  de: "Das Team von IGS-Pharma",
  en: "The IGS-Pharma team",
};

/** The label of the tracking link in `order_shipped`. */
const TRACKING_LINK: Record<MailLocale, string> = {
  nl: "Volg uw pakje",
  fr: "Suivre votre colis",
  de: "Ihr Paket verfolgen",
  en: "Track your parcel",
};

const COPY: Record<OrderMailTemplateName, Record<MailLocale, Copy>> = {
  // igs-pharma#202: the parcel is with the carrier. Names the order, never what is in it.
  order_shipped: {
    nl: {
      subject: (ref) => `Uw bestelling ${ref} is onderweg`,
      lines: (ref) => [
        `Uw bestelling ${ref} is door de apotheek gecontroleerd, verpakt en aan de vervoerder overhandigd.`,
        "De vervoerder levert het pakje op het adres dat u bij de bestelling opgaf.",
      ],
    },
    fr: {
      subject: (ref) => `Votre commande ${ref} est en route`,
      lines: (ref) => [
        `Votre commande ${ref} a été vérifiée par la pharmacie, emballée et remise au transporteur.`,
        "Le transporteur livrera le colis à l'adresse indiquée lors de votre commande.",
      ],
    },
    de: {
      subject: (ref) => `Ihre Bestellung ${ref} ist unterwegs`,
      lines: (ref) => [
        `Ihre Bestellung ${ref} wurde von der Apotheke geprüft, verpackt und dem Paketdienst übergeben.`,
        "Der Paketdienst liefert das Paket an die Adresse, die Sie bei der Bestellung angegeben haben.",
      ],
    },
    en: {
      subject: (ref) => `Your order ${ref} is on its way`,
      lines: (ref) => [
        `Your order ${ref} has been checked by the pharmacy, packed and handed to the carrier.`,
        "The carrier will deliver the parcel to the address you gave with your order.",
      ],
    },
  },
  // igs-pharma#189: a recall. Interim wording until counsel confirms what a recall notice may say: it
  // names the order, never the product, and asks the customer to contact the pharmacy.
  order_recall_notice: {
    nl: {
      subject: (ref) => `Belangrijke informatie over uw bestelling ${ref}`,
      lines: (ref) => [
        `We hebben belangrijke informatie over een product uit uw bestelling ${ref}.`,
        "Neem zo snel mogelijk contact op met de apotheek: we leggen u uit wat u moet doen.",
        "Gebruik het product niet verder tot u met ons gesproken hebt.",
      ],
    },
    fr: {
      subject: (ref) => `Information importante sur votre commande ${ref}`,
      lines: (ref) => [
        `Nous avons une information importante au sujet d'un produit de votre commande ${ref}.`,
        "Contactez la pharmacie dès que possible : nous vous expliquerons ce qu'il faut faire.",
        "N'utilisez plus le produit avant de nous avoir parlé.",
      ],
    },
    de: {
      subject: (ref) => `Wichtige Information zu Ihrer Bestellung ${ref}`,
      lines: (ref) => [
        `Wir haben eine wichtige Information zu einem Produkt aus Ihrer Bestellung ${ref}.`,
        "Bitte wenden Sie sich so bald wie möglich an die Apotheke: Wir erklären Ihnen, was zu tun ist.",
        "Verwenden Sie das Produkt nicht weiter, bevor Sie mit uns gesprochen haben.",
      ],
    },
    en: {
      subject: (ref) => `Important information about your order ${ref}`,
      lines: (ref) => [
        `We have important information about a product in your order ${ref}.`,
        "Please contact the pharmacy as soon as possible: we will explain what to do.",
        "Do not use the product any further until you have spoken to us.",
      ],
    },
  },
  order_received: {
    nl: {
      subject: (ref) => `We hebben uw bestelling ${ref} ontvangen`,
      lines: (ref) => [
        `We hebben uw bestelling ${ref} en uw betaling ontvangen.`,
        "De apotheek controleert nu uw bestelling. We laten u weten wanneer ze klaar is om af te halen.",
      ],
    },
    fr: {
      subject: (ref) => `Nous avons reçu votre commande ${ref}`,
      lines: (ref) => [
        `Nous avons reçu votre commande ${ref} et votre paiement.`,
        "La pharmacie vérifie maintenant votre commande. Nous vous préviendrons quand elle sera prête à être retirée.",
      ],
    },
    de: {
      subject: (ref) => `Wir haben Ihre Bestellung ${ref} erhalten`,
      lines: (ref) => [
        `Wir haben Ihre Bestellung ${ref} und Ihre Zahlung erhalten.`,
        "Die Apotheke prüft jetzt Ihre Bestellung. Wir benachrichtigen Sie, sobald sie zur Abholung bereitliegt.",
      ],
    },
    en: {
      subject: (ref) => `We have received your order ${ref}`,
      lines: (ref) => [
        `We have received your order ${ref} and your payment.`,
        "The pharmacy is now checking your order. We will let you know when you can collect it.",
      ],
    },
  },
  order_stock_short: {
    nl: {
      subject: (ref) => `Uw bestelling ${ref}: een product is niet beschikbaar`,
      lines: (ref) => [
        `We hebben uw betaling voor bestelling ${ref} ontvangen, maar een of meer producten zijn op dit moment niet beschikbaar.`,
        "Ons apotheekteam bekijkt uw bestelling en neemt contact met u op over de volgende stappen.",
      ],
    },
    fr: {
      subject: (ref) => `Votre commande ${ref} : un produit n'est pas disponible`,
      lines: (ref) => [
        `Nous avons reçu votre paiement pour la commande ${ref}, mais un ou plusieurs produits ne sont pas disponibles pour le moment.`,
        "Notre équipe de la pharmacie examine votre commande et vous contactera pour la suite.",
      ],
    },
    de: {
      subject: (ref) => `Ihre Bestellung ${ref}: ein Produkt ist nicht verfügbar`,
      lines: (ref) => [
        `Wir haben Ihre Zahlung für die Bestellung ${ref} erhalten, aber ein oder mehrere Produkte sind derzeit nicht verfügbar.`,
        "Unser Apothekenteam prüft Ihre Bestellung und meldet sich bei Ihnen zu den nächsten Schritten.",
      ],
    },
    en: {
      subject: (ref) => `Your order ${ref}: an item is unavailable`,
      lines: (ref) => [
        `We have received your payment for order ${ref}, but one or more items in your order are currently unavailable.`,
        "Our pharmacy team is reviewing the order and will contact you about the next steps.",
      ],
    },
  },
  order_ready_for_pickup: {
    nl: {
      subject: (ref) => `Uw bestelling ${ref} ligt klaar`,
      lines: (ref) => [
        `Uw bestelling ${ref} is door de apotheek gecontroleerd en ligt klaar om af te halen.`,
        "Vermeld uw bestelnummer wanneer u ze komt afhalen.",
      ],
    },
    fr: {
      subject: (ref) => `Votre commande ${ref} est prête`,
      lines: (ref) => [
        `Votre commande ${ref} a été vérifiée par la pharmacie et est prête à être retirée.`,
        "Mentionnez votre numéro de commande lorsque vous venez la retirer.",
      ],
    },
    de: {
      subject: (ref) => `Ihre Bestellung ${ref} liegt bereit`,
      lines: (ref) => [
        `Ihre Bestellung ${ref} wurde von der Apotheke geprüft und liegt zur Abholung bereit.`,
        "Nennen Sie bei der Abholung bitte Ihre Bestellnummer.",
      ],
    },
    en: {
      subject: (ref) => `Your order ${ref} is ready`,
      lines: (ref) => [
        `Your order ${ref} has been checked by the pharmacy and is ready for collection.`,
        "Please mention your order number when you collect it.",
      ],
    },
  },
  order_refund_initiated: {
    nl: {
      subject: (ref) => `Uw bestelling ${ref} is geannuleerd`,
      lines: (ref, amount) => [
        `Uw bestelling ${ref} kon niet worden uitgevoerd. We hebben de bestelling geannuleerd en een terugbetaling van ${amount} naar uw oorspronkelijke betaalmethode in gang gezet.`,
        "U krijgt nog een bericht zodra de terugbetaling is uitgevoerd.",
      ],
    },
    fr: {
      subject: (ref) => `Votre commande ${ref} a été annulée`,
      lines: (ref, amount) => [
        `Votre commande ${ref} n'a pas pu être traitée. Nous avons annulé la commande et lancé le remboursement de ${amount} sur votre moyen de paiement d'origine.`,
        "Vous recevrez un autre message dès que le remboursement aura été effectué.",
      ],
    },
    de: {
      subject: (ref) => `Ihre Bestellung ${ref} wurde storniert`,
      lines: (ref, amount) => [
        `Ihre Bestellung ${ref} konnte nicht ausgeführt werden. Wir haben die Bestellung storniert und eine Erstattung von ${amount} auf Ihr ursprüngliches Zahlungsmittel veranlasst.`,
        "Sie erhalten eine weitere Nachricht, sobald die Erstattung ausgeführt wurde.",
      ],
    },
    en: {
      subject: (ref) => `Your order ${ref} has been cancelled`,
      lines: (ref, amount) => [
        `Your order ${ref} could not be fulfilled. We have cancelled the order and initiated a refund of ${amount} to your original payment method.`,
        "You will receive another message once the refund has been completed.",
      ],
    },
  },
  order_refund_completed: {
    nl: {
      subject: (ref) => `Terugbetaling voor bestelling ${ref} uitgevoerd`,
      lines: (ref, amount) => [
        `De terugbetaling van ${amount} voor uw bestelling ${ref} is uitgevoerd.`,
        "Afhankelijk van uw bank kan het enkele dagen duren voordat het bedrag op uw rekening staat.",
      ],
    },
    fr: {
      subject: (ref) => `Remboursement de la commande ${ref} effectué`,
      lines: (ref, amount) => [
        `Le remboursement de ${amount} pour votre commande ${ref} a été effectué.`,
        "Selon votre banque, quelques jours peuvent être nécessaires avant que le montant apparaisse sur votre compte.",
      ],
    },
    de: {
      subject: (ref) => `Erstattung für Bestellung ${ref} ausgeführt`,
      lines: (ref, amount) => [
        `Die Erstattung von ${amount} für Ihre Bestellung ${ref} wurde ausgeführt.`,
        "Je nach Bank kann es einige Tage dauern, bis der Betrag auf Ihrem Konto erscheint.",
      ],
    },
    en: {
      subject: (ref) => `Refund for order ${ref} completed`,
      lines: (ref, amount) => [
        `The refund of ${amount} for your order ${ref} has been completed.`,
        "Depending on your bank, it can take a few days before the amount appears on your account.",
      ],
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
const oneLine = (value: string): string => value.replace(/[\r\n]+/g, " ").trim();

const NUMBER_LOCALE: Record<MailLocale, string> = {
  nl: "nl-BE",
  fr: "fr-BE",
  de: "de-BE",
  en: "en-BE",
};

/** 1250 cents → "€ 12,50" in the mail's language. */
export const formatAmount = (cents: number, locale: MailLocale): string =>
  new Intl.NumberFormat(NUMBER_LOCALE[locale], { style: "currency", currency: "EUR" })
    .format(cents / 100)
    // a plain space: the narrow and non-breaking ones show as odd characters in some mail clients
    .replace(/[\u00a0\u202f]/g, " ");

export const isOrderMailTemplate = (value: string): value is OrderMailTemplateName =>
  (ORDER_MAIL_TEMPLATES as readonly string[]).includes(value);

/**
 * The subject, plain text and HTML of one order mail. An unknown locale falls back to Dutch. A
 * refund template without an amount throws: a refund mail never goes out without its amount.
 */
export function renderOrderMail(
  template: OrderMailTemplateName,
  locale: string,
  data: OrderMailData,
): { subject: string; text: string; html: string } {
  const lang: MailLocale = isMailLocale(locale) ? locale : "nl";
  const copy = COPY[template][lang];
  const cents = data.amountCents;
  if (
    NEEDS_AMOUNT.includes(template) &&
    (cents === undefined || !Number.isSafeInteger(cents) || cents <= 0)
  ) {
    throw new Error(`mail.amount_missing: template ${template}`);
  }
  const reference = oneLine(data.reference);
  const amount = cents ? formatAmount(cents, lang) : "";
  const greeting = GREETING[lang](oneLine(data.name)).replace(/\s+,/, ",");
  const lines = copy.lines(reference, amount);
  const signOff = SIGN_OFF[lang];

  // only the shipped mail carries a link, and only an https one without spaces or markup
  const link =
    template === "order_shipped" &&
    data.trackingUrl &&
    /^https:\/\/[^\s<>"']+$/.test(data.trackingUrl) &&
    data.trackingUrl.length <= 500
      ? data.trackingUrl
      : null;
  const linkLabel = TRACKING_LINK[lang];

  const text = [
    greeting,
    "",
    ...lines.flatMap((line) => [line, ""]),
    ...(link ? [`${linkLabel}: ${link}`, ""] : []),
    signOff,
    "",
  ].join("\n");
  const html = [
    "<!doctype html>",
    '<html><body style="font-family: Arial, Helvetica, sans-serif; line-height: 1.5; color: #1a1a1a;">',
    `<p>${escapeHtml(greeting)}</p>`,
    ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    ...(link ? [`<p><a href="${escapeHtml(link)}">${escapeHtml(linkLabel)}</a></p>`] : []),
    `<p>${escapeHtml(signOff)}</p>`,
    "</body></html>",
  ].join("\n");
  return { subject: copy.subject(reference), text, html };
}
