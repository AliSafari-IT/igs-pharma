/**
 * Who runs the pharmacy: the identity block of the storefront footer (igs-pharma#104, backlog C11).
 * One typed object, edited in one place when the real details arrive from the owner.
 *
 * While `isPlaceholder` is `true` every value is a bracketed stand-in and the storefront shows a
 * visible "placeholder, to be replaced" marker next to it. Setting it to `false` is a deliberate
 * act: the test in `pharmacy.test.ts` then refuses any value that is still a stand-in. It means the
 * owner answered and confirmed all of section 1 of igs-pharma#238 (1.1 to 1.7), the values that are
 * already filled in (the pharmacist-titular, the VAT number) included; the launch check
 * (`launch.ts`) keeps the shop closed until then.
 *
 * Nothing here is a secret; it is the public information a Belgian pharmacy site must show.
 */
export interface PharmacyIdentity {
  /** `true` while any value below is a stand-in. */
  readonly isPlaceholder: boolean;
  /** The shop's name as customers know it. */
  readonly name: string;
  /**
   * The exact legal name of the company that runs the pharmacy (igs-pharma#238 item 1.7), shown
   * next to its VAT number.
   */
  readonly legalName: string;
  readonly address: {
    readonly street: string;
    readonly postalCode: string;
    readonly city: string;
    readonly country: string;
  };
  readonly phone: string;
  readonly email: string;
  /** The pharmacist-titular (titularis), responsible for the pharmacy. */
  readonly pharmacistTitular: string;
  /** The pharmacy's authorisation number from the competent authority. */
  readonly authorisationNumber: string;
  /** The VAT number of the company that runs the pharmacy (milestone 5.1, C11), for example "BE 0123.456.789". */
  readonly vatNumber: string;
  /** Opening hours, one line. */
  readonly openingHours: string;
}

export const PHARMACY_IDENTITY: PharmacyIdentity = {
  isPlaceholder: true,
  name: "IGS-Pharma",
  legalName: "[company legal name]",
  address: {
    street: "[street and number]",
    postalCode: "[postal code]",
    city: "[city]",
    country: "Belgium",
  },
  phone: "[phone number]",
  email: "[e-mail address]",
  pharmacistTitular: "Djavad Salehi",
  authorisationNumber: "[authorisation number]",
  vatNumber: "BE 0739.742.487",
  openingHours: "[opening hours]",
};

/** Whether a value is still a bracketed stand-in. */
export const isStandIn = (value: string): boolean => /^\[.*\]$/.test(value.trim());

/** Every free-text value of the identity, for the placeholder guard. */
export function identityValues(identity: PharmacyIdentity): string[] {
  return [
    identity.name,
    identity.legalName,
    identity.address.street,
    identity.address.postalCode,
    identity.address.city,
    identity.address.country,
    identity.phone,
    identity.email,
    identity.pharmacistTitular,
    identity.authorisationNumber,
    identity.vatNumber,
    identity.openingHours,
  ];
}

/**
 * Where the EU common logo links to: the pharmacy's own entry on the FAMHP's list of registered
 * online pharmacies (igs-pharma#238 item 2.2). The site's root stands in until the owner sends the
 * link; `isFamhpEntryUrl` refuses it, so the logo cannot show and the launch check stays red (the
 * logo and its link are a pair: never turn one on without the other).
 */
export const EU_COMMON_LOGO_LIST_URL = "https://www.famhp.be";

/** The FAMHP's sites, in its three languages and English (FAGG in Dutch, AFMPS in French). */
const FAMHP_HOSTS = ["famhp.be", "fagg.be", "afmps.be", "fagg-afmps.be"];

/**
 * Whether `url` can be the EU logo's link: https, on a FAMHP site, and a page deeper than the site's
 * root (the root is the stand-in, never an entry on the list).
 */
export function isFamhpEntryUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const onFamhp = FAMHP_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  const deeper = parsed.pathname.replace(/\/+$/, "") !== "" || parsed.search !== "";
  return parsed.protocol === "https:" && onFamhp && deeper;
}
