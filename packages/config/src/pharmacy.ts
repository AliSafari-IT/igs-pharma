/**
 * Who runs the pharmacy: the identity block of the storefront footer (igs-pharma#104, backlog C11).
 * One typed object, edited in one place when the real details arrive from the owner.
 *
 * While `isPlaceholder` is `true` every value is a bracketed stand-in and the storefront shows a
 * visible "placeholder, to be replaced" marker next to it. Setting it to `false` is a deliberate
 * act: the test in `pharmacy.test.ts` then refuses any value that is still a stand-in.
 *
 * Nothing here is a secret; it is the public information a Belgian pharmacy site must show.
 */
export interface PharmacyIdentity {
  /** `true` while any value below is a stand-in. */
  readonly isPlaceholder: boolean;
  readonly name: string;
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
  address: {
    street: "[street and number]",
    postalCode: "[postal code]",
    city: "[city]",
    country: "Belgium",
  },
  phone: "[phone number]",
  email: "[e-mail address]",
  pharmacistTitular: "[name of the pharmacist-titular]",
  authorisationNumber: "[authorisation number]",
  vatNumber: "[VAT number]",
  openingHours: "[opening hours]",
};

/** Whether a value is still a bracketed stand-in. */
export const isStandIn = (value: string): boolean => /^\[.*\]$/.test(value.trim());

/** Every free-text value of the identity, for the placeholder guard. */
export function identityValues(identity: PharmacyIdentity): string[] {
  return [
    identity.name,
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
 * Where the EU common logo links to: the FAMHP's list of registered online pharmacies. The site's
 * root stands in until the owner confirms the exact list page when the flag is turned on (the
 * logo and its link are a pair: never turn one on without the other).
 */
export const EU_COMMON_LOGO_LIST_URL = "https://www.famhp.be";
