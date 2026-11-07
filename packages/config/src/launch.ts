/**
 * Launch readiness (igs-pharma#238): ONE check of everything only the pharmacy owner (or the
 * titular pharmacist, the accountant, counsel) can answer before the webshop opens. Each check
 * names the #238 items it covers, so an answer becomes a small change in one known place:
 *
 * - the pharmacy's details: `PHARMACY_IDENTITY` in `pharmacy.ts` (1.x);
 * - the EU logo: `EU_COMMON_LOGO_LIST_URL` (2.2) and `NEXT_PUBLIC_FEATURE_EU_COMMON_LOGO`;
 * - every other answer that has no setting of its own: `LAUNCH_DECISIONS` below;
 * - server settings (`MOLLIE_API_KEY`, `SENDCLOUD_*`) and the delivery amounts in the back-office.
 *
 * The storefront refuses to open (`SITE_GATE=off`) while a check is `missing` (`storefrontGate`,
 * `LAUNCH_CHECK`), and the back-office lists every check for the owner. Pure: nothing here
 * logs, reads the database or decides who may see it (the callers do, D-005).
 */
import { z } from "zod";

import { appEnv, launchCheckEnforced, launchCheckEnv, siteGateEnabled, siteGateEnv } from "./env";
import { getFeatureFlags } from "./feature-flags";
import {
  EU_COMMON_LOGO_LIST_URL,
  PHARMACY_IDENTITY,
  type PharmacyIdentity,
  identityValues,
  isFamhpEntryUrl,
  isStandIn,
} from "./pharmacy";

/**
 * The owner's answers that live nowhere else, each in its "not answered yet" state. Change a value
 * only when the answer is in the #238 thread (and, where it says so, after the code it needs has
 * landed); never to get the shop open. The comment on each names the item and what else changes.
 */
export interface LaunchDecisions {
  /**
   * 2.1: the FAMHP was notified of the online sale and lists the pharmacy as a registered online
   * pharmacy. With it: the entry's link in `EU_COMMON_LOGO_LIST_URL` (2.2).
   */
  readonly famhpRegistered: boolean;
  /**
   * 3.1–3.3 and the returns policy (5.6): the terms, privacy and cookie pages carry counsel's final
   * text (the storefront's legal pages and their i18n messages), naming the data controller and the
   * privacy address.
   */
  readonly legalTexts: "pending" | "final";
  /**
   * 3.4, 3.5: the customer order mails (`packages/mail/src/order-templates.ts`), the recall notice
   * included, were approved by the titular pharmacist or counsel, in all four languages.
   */
  readonly orderMailWording: "interim" | "approved";
  /**
   * 3.6–3.9: the DPAs with Mollie and Sendcloud are signed, the privacy adviser (DPO) is named, the
   * DPIA is written and the production hosting is decided (ADR-0005 in the docs repo). Documents the
   * pharmacy keeps: the owner confirms them here.
   */
  readonly privacyGroundwork: "open" | "done";
  /** 4.2: the payment methods offered (`INSTANT_METHODS` in `packages/payments`) are confirmed. */
  readonly paymentMethods: "proposed" | "confirmed";
  /**
   * 5.1 (and 5.4, Belgium only as built): how orders reach customers at launch. `home-delivery` also
   * needs `NEXT_PUBLIC_FEATURE_HOME_DELIVERY`, Sendcloud, the delivery amounts, 5.5 and 6.1;
   * `pickup-only` needs the home-delivery switch off.
   */
  readonly deliveryAtLaunch: "undecided" | "pickup-only" | "home-delivery";
  /**
   * 5.5: whether cold-chain products may be sent home. A "pickup only" answer needs the checkout rule
   * that enforces it first (igs-pharma#243); its value is added with that rule.
   */
  readonly coldChainDelivery: "undecided" | "allowed";
  /**
   * 6.1: the accountant confirmed the VAT rate on the delivery fee (`DELIVERY_VAT_RATE_BP` in
   * `packages/modules/orders/src/delivery-domain.ts`, 21 % today; change it there if they say so).
   */
  readonly deliveryVatRate: "to-confirm" | "confirmed";
  /**
   * 6.2: how online orders are invoiced. `outside-the-shop`: the accountant's or Officinall's
   * software issues them. If the shop must issue them, that is a new work package (invoices are not
   * built, board question O-4) and its value is added with it.
   */
  readonly invoicing: "undecided" | "outside-the-shop";
}

export const LAUNCH_DECISIONS: LaunchDecisions = {
  famhpRegistered: false,
  legalTexts: "pending",
  orderMailWording: "interim",
  privacyGroundwork: "open",
  paymentMethods: "proposed",
  deliveryAtLaunch: "undecided",
  coldChainDelivery: "undecided",
  deliveryVatRate: "to-confirm",
  invoicing: "undecided",
};

export const LAUNCH_CHECK_IDS = [
  "pharmacy_details",
  "famhp_registration",
  "eu_logo",
  "legal_texts",
  "order_mails",
  "privacy_groundwork",
  "payments",
  "payment_methods",
  "delivery_choice",
  "shop_switches",
  "shipping",
  "delivery_rates",
  "cold_chain",
  "delivery_vat",
  "invoices",
  "back_office_access",
] as const;
export type LaunchCheckId = (typeof LAUNCH_CHECK_IDS)[number];

/**
 * - `ok`: answered and in place;
 * - `missing`: blocks the opening;
 * - `not_needed`: does not apply to the answers given so far (home delivery bits for pickup only);
 * - `elsewhere`: this process cannot see it (the back-office cannot see the storefront's settings,
 *   and the other way round); the other one checks it;
 * - `unknown`: it could not be read just now (the delivery amounts failed to load);
 * - `manual`: no code can check it (a server setting outside this repository).
 */
export type LaunchStatus = "ok" | "missing" | "not_needed" | "elsewhere" | "unknown" | "manual";

export interface LaunchCheck {
  readonly id: LaunchCheckId;
  /** The #238 items it covers, e.g. "1.1–1.7". */
  readonly items: string;
  /** What is checked, one short line. */
  readonly title: string;
  readonly status: LaunchStatus;
  /** What is still needed (or why it is fine), one or two sentences. Never a value of a secret. */
  readonly detail: string;
}

/** The Mollie key the storefront holds: only its kind, never the key. */
export type MollieKeyKind = "live" | "test" | "none";

/** What the storefront process sees. */
export interface StorefrontFacts {
  readonly flags: {
    readonly cart: boolean;
    readonly homeDelivery: boolean;
    readonly euCommonLogo: boolean;
  };
  readonly mollieKey: MollieKeyKind;
  readonly storefrontUrlSet: boolean;
  readonly stage: "staging" | "production" | undefined;
}

/** What the back-office process sees. */
export interface BackOfficeFacts {
  /** The Sendcloud key pair and shipping method are set. */
  readonly sendcloudConfigured: boolean;
  /** Staff saved their own delivery amounts; `undefined` when they could not be read (or may not be). */
  readonly deliveryRatesSet: boolean | undefined;
}

export interface LaunchFacts {
  readonly identity: PharmacyIdentity;
  readonly euLogoUrl: string;
  readonly decisions: LaunchDecisions;
  /** Absent outside the storefront: those checks are `elsewhere`. */
  readonly storefront?: StorefrontFacts | undefined;
  /** Absent outside the back-office: those checks are `elsewhere`. */
  readonly backOffice?: BackOfficeFacts | undefined;
}

export interface LaunchReadiness {
  readonly checks: readonly LaunchCheck[];
  /** The `missing` checks: the shop may open only when this is empty. */
  readonly missing: readonly LaunchCheck[];
  readonly ready: boolean;
}

/** The facts held in code, the same in every process. */
export function codeLaunchFacts(): LaunchFacts {
  return {
    identity: PHARMACY_IDENTITY,
    euLogoUrl: EU_COMMON_LOGO_LIST_URL,
    decisions: LAUNCH_DECISIONS,
  };
}

const storefrontSettingsEnv = z.object({
  MOLLIE_API_KEY: z.string().optional(),
  STOREFRONT_URL: z.string().optional(),
  DEPLOY_STAGE: z.string().optional(),
});

/**
 * What the storefront process sees in its environment (`process.env`). Never throws: a value that
 * does not parse counts as not set (the payments code refuses it the same way).
 */
export function storefrontLaunchFacts(): StorefrontFacts {
  const parsed = storefrontSettingsEnv.safeParse(process.env);
  const env = parsed.success ? parsed.data : {};
  const key = env.MOLLIE_API_KEY?.trim() ?? "";
  const mollieKey: MollieKeyKind = /^live_[A-Za-z0-9]{20,}$/.test(key)
    ? "live"
    : /^test_[A-Za-z0-9]{20,}$/.test(key)
      ? "test"
      : "none";
  const { cart, homeDelivery, euCommonLogo } = getFeatureFlags();
  const stage =
    env.DEPLOY_STAGE === "staging" || env.DEPLOY_STAGE === "production"
      ? env.DEPLOY_STAGE
      : undefined;
  return {
    flags: { cart, homeDelivery, euCommonLogo },
    mollieKey,
    storefrontUrlSet: (env.STOREFRONT_URL?.trim() ?? "") !== "",
    stage,
  };
}

/** Whether the footer may show the EU common logo: the flag, the real details and a registered entry. */
export function euCommonLogoAllowed(
  flagOn: boolean,
  facts: LaunchFacts = codeLaunchFacts(),
): boolean {
  return (
    flagOn &&
    !facts.identity.isPlaceholder &&
    facts.decisions.famhpRegistered &&
    isFamhpEntryUrl(facts.euLogoUrl)
  );
}

const ELSEWHERE_STOREFRONT =
  "The storefront checks this setting itself and stays closed while it is missing.";
const ELSEWHERE_BACK_OFFICE = "The back-office checks this; see its launch checklist.";

/** Every launch check, in #238 order. */
export function launchReadiness(facts: LaunchFacts): LaunchReadiness {
  const { identity, decisions: d, storefront: sf, backOffice: bo } = facts;
  const homeDelivery = d.deliveryAtLaunch === "home-delivery";
  const checks: LaunchCheck[] = [];
  const add = (
    id: LaunchCheckId,
    items: string,
    title: string,
    status: LaunchStatus,
    detail: string,
  ) => checks.push({ id, items, title, status, detail });

  // 1.x
  const standIns = identityValues(identity).filter(isStandIn).length;
  add(
    "pharmacy_details",
    "1.1–1.7",
    "Pharmacy details on the site",
    !identity.isPlaceholder && standIns === 0 ? "ok" : "missing",
    !identity.isPlaceholder && standIns === 0
      ? "Filled in and confirmed by the owner."
      : `${standIns} ${standIns === 1 ? "value is" : "values are"} still a stand-in, and the owner has not confirmed the details yet (PHARMACY_IDENTITY, isPlaceholder).`,
  );

  // 2.1, 2.2
  const entryUrl = isFamhpEntryUrl(facts.euLogoUrl);
  const registered = d.famhpRegistered && entryUrl;
  add(
    "famhp_registration",
    "2.1, 2.2",
    "Registered with the FAMHP for online sale",
    registered ? "ok" : "missing",
    registered
      ? "Registered; the EU logo links to the pharmacy's entry."
      : !d.famhpRegistered
        ? "The pharmacy is not yet confirmed as registered with the FAMHP, and the link to its entry on the list is not in yet."
        : "Registered, but EU_COMMON_LOGO_LIST_URL is still not the pharmacy's entry on the FAMHP list.",
  );
  if (!sf)
    add("eu_logo", "2.2", "EU common logo shown in the footer", "elsewhere", ELSEWHERE_STOREFRONT);
  else {
    const shown = euCommonLogoAllowed(sf.flags.euCommonLogo, facts);
    add(
      "eu_logo",
      "2.2",
      "EU common logo shown in the footer",
      shown ? "ok" : "missing",
      shown
        ? "The footer shows the logo with its link."
        : sf.flags.euCommonLogo
          ? "NEXT_PUBLIC_FEATURE_EU_COMMON_LOGO is on, but the logo stays hidden until the pharmacy details and the FAMHP registration are in."
          : "NEXT_PUBLIC_FEATURE_EU_COMMON_LOGO is off; turn it on once 1.x and 2.x are in.",
    );
  }

  // 3.x
  add(
    "legal_texts",
    "3.1–3.3, 5.6",
    "Terms, privacy and cookie texts",
    d.legalTexts === "final" ? "ok" : "missing",
    d.legalTexts === "final"
      ? "Counsel's final texts are on the site."
      : "The legal pages still say the text is coming from the pharmacy's counsel.",
  );
  add(
    "order_mails",
    "3.4, 3.5",
    "Wording of the order and recall e-mails approved",
    d.orderMailWording === "approved" ? "ok" : "missing",
    d.orderMailWording === "approved"
      ? "Approved in all four languages."
      : "The order e-mails, the recall notice included, still use interim wording nobody has approved.",
  );
  add(
    "privacy_groundwork",
    "3.6–3.9",
    "Data processing agreements, privacy adviser, DPIA, hosting",
    d.privacyGroundwork === "done" ? "ok" : "missing",
    d.privacyGroundwork === "done"
      ? "Confirmed by the owner."
      : "The DPAs with Mollie and Sendcloud, the privacy adviser, the DPIA and the hosting decision are not confirmed yet.",
  );

  // 4.x
  if (!sf) add("payments", "4.1", "Payments by Mollie", "elsewhere", ELSEWHERE_STOREFRONT);
  else {
    const keyOk = sf.mollieKey === "live" || (sf.mollieKey === "test" && sf.stage === "staging");
    const ok = keyOk && sf.storefrontUrlSet;
    add(
      "payments",
      "4.1",
      "Payments by Mollie",
      ok ? "ok" : "missing",
      ok
        ? sf.mollieKey === "live"
          ? "A live Mollie key is set."
          : "A Mollie test key is set (accepted on staging only)."
        : sf.mollieKey === "none"
          ? "MOLLIE_API_KEY is not set in the server settings: nobody can pay."
          : sf.mollieKey === "test" && sf.stage !== "staging"
            ? "Only a Mollie test key is set: the live shop needs the pharmacy's live key (DEPLOY_STAGE=staging accepts a test key)."
            : "STOREFRONT_URL is not set, so Mollie has nowhere to send the customer back to.",
    );
  }
  add(
    "payment_methods",
    "4.2",
    "Payment methods confirmed",
    d.paymentMethods === "confirmed" ? "ok" : "missing",
    d.paymentMethods === "confirmed"
      ? "Confirmed by the owner."
      : "The shop offers Bancontact, cards and Apple Pay for now; the owner has not confirmed the list.",
  );

  // 5.x
  add(
    "delivery_choice",
    "5.1, 5.4",
    "Home delivery or pickup only",
    d.deliveryAtLaunch === "undecided" ? "missing" : "ok",
    d.deliveryAtLaunch === "undecided"
      ? "Not decided yet whether the shop opens with home delivery or pickup at the pharmacy only."
      : d.deliveryAtLaunch === "home-delivery"
        ? "Home delivery (Belgium only) and pickup."
        : "Pickup at the pharmacy only.",
  );
  if (!sf)
    add(
      "shop_switches",
      "5.1",
      "Shop switches on the storefront",
      "elsewhere",
      ELSEWHERE_STOREFRONT,
    );
  else {
    const deliveryMatches =
      d.deliveryAtLaunch === "undecided" || sf.flags.homeDelivery === homeDelivery;
    const ok = sf.flags.cart && deliveryMatches;
    add(
      "shop_switches",
      "5.1",
      "Shop switches on the storefront",
      ok ? "ok" : "missing",
      ok
        ? "The cart is on and home delivery matches the decision."
        : !sf.flags.cart
          ? "NEXT_PUBLIC_FEATURE_CART is off: nobody can order."
          : homeDelivery
            ? "Home delivery was chosen, but NEXT_PUBLIC_FEATURE_HOME_DELIVERY is off."
            : "Pickup only was chosen, but NEXT_PUBLIC_FEATURE_HOME_DELIVERY is on.",
    );
  }
  const onlyForDelivery = "Only needed with home delivery.";
  if (!homeDelivery) {
    add("shipping", "5.2", "Sendcloud set up for labels", "not_needed", onlyForDelivery);
    add(
      "delivery_rates",
      "5.3",
      "Delivery price and free-delivery amount",
      "not_needed",
      onlyForDelivery,
    );
    add(
      "cold_chain",
      "5.5",
      "Cold-chain products and home delivery",
      "not_needed",
      onlyForDelivery,
    );
  } else {
    if (!bo)
      add("shipping", "5.2", "Sendcloud set up for labels", "elsewhere", ELSEWHERE_BACK_OFFICE);
    else
      add(
        "shipping",
        "5.2",
        "Sendcloud set up for labels",
        bo.sendcloudConfigured ? "ok" : "missing",
        bo.sendcloudConfigured
          ? "The Sendcloud keys and shipping method are set."
          : "The Sendcloud keys or the shipping method (SENDCLOUD_*) are not in the server settings: no labels can be made.",
      );
    if (!bo)
      add(
        "delivery_rates",
        "5.3",
        "Delivery price and free-delivery amount",
        "elsewhere",
        ELSEWHERE_BACK_OFFICE,
      );
    else
      add(
        "delivery_rates",
        "5.3",
        "Delivery price and free-delivery amount",
        bo.deliveryRatesSet === undefined ? "unknown" : bo.deliveryRatesSet ? "ok" : "missing",
        bo.deliveryRatesSet === undefined
          ? "The delivery settings could not be read just now."
          : bo.deliveryRatesSet
            ? "Set in Settings › Delivery."
            : "The shop still uses the default amounts: set them in Settings › Delivery.",
      );
    add(
      "cold_chain",
      "5.5",
      "Cold-chain products and home delivery",
      d.coldChainDelivery === "undecided" ? "missing" : "ok",
      d.coldChainDelivery === "undecided"
        ? "Not decided yet whether cold-chain products may be sent home."
        : "Cold-chain products may be sent home.",
    );
  }

  // 6.x
  add(
    "delivery_vat",
    "6.1",
    "VAT on the delivery fee",
    !homeDelivery ? "not_needed" : d.deliveryVatRate === "confirmed" ? "ok" : "missing",
    !homeDelivery
      ? "Pickup is free, so there is no delivery fee to charge VAT on."
      : d.deliveryVatRate === "confirmed"
        ? "Confirmed by the accountant."
        : "The accountant has not confirmed the 21 % VAT on the delivery fee yet.",
  );
  add(
    "invoices",
    "6.2",
    "How online orders are invoiced",
    d.invoicing === "undecided" ? "missing" : "ok",
    d.invoicing === "undecided"
      ? "Not decided yet who issues invoices for online orders, and in which numbering series."
      : "Invoices are issued outside the shop.",
  );

  // 7.1
  add(
    "back_office_access",
    "7.1",
    "Back-office reachable from the pharmacy",
    "manual",
    "The pharmacy's internet address goes on the server's allowlist (IGS_PLATFORM_ALLOW_IPS, outside this repository): no code can check it.",
  );

  const missing = checks.filter((check) => check.status === "missing");
  return { checks, missing, ready: missing.length === 0 };
}

export interface StorefrontGate {
  /** The storefront answers with the "coming soon" page. */
  readonly closed: boolean;
  /** `SITE_GATE=off` was set, and the launch check kept the shop closed anyway. */
  readonly refused: boolean;
  /** `LAUNCH_CHECK` enforces (the default in production). */
  readonly enforced: boolean;
  readonly readiness: LaunchReadiness;
}

const gateEnv = appEnv
  .pick({ NODE_ENV: true })
  .extend(siteGateEnv.shape)
  .extend(launchCheckEnv.shape);

/**
 * The storefront's gate (igs-pharma#46) with the launch check (#238): closed as `SITE_GATE` says,
 * and also closed when `SITE_GATE=off` but a launch item is missing and `LAUNCH_CHECK` enforces.
 * Reads `process.env`; throws on an invalid `SITE_GATE`/`LAUNCH_CHECK` like `parseEnvFor` does.
 */
export function storefrontGate(): StorefrontGate {
  const parsed = gateEnv.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  const readiness = launchReadiness({ ...codeLaunchFacts(), storefront: storefrontLaunchFacts() });
  const configured = siteGateEnabled(env);
  const enforced = launchCheckEnforced(env);
  const refused = !configured && enforced && !readiness.ready;
  return { closed: configured || refused, refused, enforced, readiness };
}
