import type { Locale } from "./api/types";

/**
 * The storefront the app reads and sends orders to. Set per build in eas.json; for a local
 * storefront on the Android emulator use `EXPO_PUBLIC_STOREFRONT_URL=http://10.0.2.2:3000`.
 */
export const STOREFRONT_URL = (
  process.env.EXPO_PUBLIC_STOREFRONT_URL ?? "https://igs-pharma.be"
).replace(/\/+$/, "");

/** The product's page on the website, where it is ordered. */
export const productWebUrl = (locale: Locale, cnk: string) =>
  `${STOREFRONT_URL}/${locale}/p/${cnk}`;

/**
 * The app's own privacy and cookie pages live on the landing page, which stays open while the
 * storefront is gated (Play needs a reachable privacy URL). The shop's terms stay on the storefront.
 */
export const LANDING_URL = "https://igs.asafarim.site";
const LANDING_PATHS: Record<"privacy" | "cookies", Record<Locale, string>> = {
  privacy: {
    nl: "/privacy/",
    fr: "/fr/confidentialite/",
    de: "/de/datenschutz/",
    en: "/en/privacy/",
  },
  cookies: { nl: "/cookies/", fr: "/fr/cookies/", de: "/de/cookies/", en: "/en/cookies/" },
};

export const LEGAL_DOCS = ["terms", "privacy", "cookies"] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];
export const legalUrl = (locale: Locale, doc: LegalDoc) =>
  doc === "terms"
    ? `${STOREFRONT_URL}/${locale}/legal/terms`
    : `${LANDING_URL}${LANDING_PATHS[doc][locale]}`;

/** Questions about personal data. */
export const PRIVACY_EMAIL = "privacy@igs-pharma.be";

/** Belgian numbers every pharmacy app should offer (nothing here depends on the pharmacy). */
export const EMERGENCY = {
  /** Pharmacy on duty (apotheek van wacht / pharmacie de garde), paying number. */
  onDutyPhone: "0903 99 000",
  onDutyWeb: "https://www.apotheek.be",
  emergency: "112",
  /** Antigifcentrum / Centre Antipoisons. */
  poisonCentre: "070 245 245",
} as const;
