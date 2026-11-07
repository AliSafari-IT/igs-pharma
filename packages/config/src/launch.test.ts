import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LAUNCH_CHECK_IDS,
  LAUNCH_DECISIONS,
  type LaunchDecisions,
  type LaunchFacts,
  type StorefrontFacts,
  codeLaunchFacts,
  euCommonLogoAllowed,
  launchReadiness,
  storefrontGate,
  storefrontLaunchFacts,
} from "./launch";
import { PHARMACY_IDENTITY, type PharmacyIdentity, isFamhpEntryUrl } from "./pharmacy";

const realIdentity: PharmacyIdentity = {
  isPlaceholder: false,
  name: "IGS-Pharma",
  legalName: "Example Pharma BV",
  address: { street: "Rue Example 1", postalCode: "1000", city: "Brussels", country: "Belgium" },
  phone: "+32 2 000 00 00",
  email: "info@example.be",
  pharmacistTitular: "A. Pharmacist",
  authorisationNumber: "123456",
  vatNumber: "BE 0123.456.789",
  openingHours: "Mon-Fri 9:00-18:00",
};

const answered: LaunchDecisions = {
  famhpRegistered: true,
  legalTexts: "final",
  orderMailWording: "approved",
  privacyGroundwork: "done",
  paymentMethods: "confirmed",
  deliveryAtLaunch: "pickup-only",
  coldChainDelivery: "undecided",
  deliveryVatRate: "to-confirm",
  invoicing: "outside-the-shop",
};

const openShop: StorefrontFacts = {
  flags: { cart: true, homeDelivery: false, euCommonLogo: true },
  mollieKey: "live",
  storefrontUrlSet: true,
  stage: "production",
};

/** Everything answered, pickup only, as the storefront sees it. */
const ready: LaunchFacts = {
  identity: realIdentity,
  euLogoUrl: "https://www.famhp.be/en/online-pharmacies/example",
  decisions: answered,
  storefront: openShop,
};

const missingIds = (facts: LaunchFacts) => launchReadiness(facts).missing.map((c) => c.id);
const statusOf = (facts: LaunchFacts, id: string) =>
  launchReadiness(facts).checks.find((c) => c.id === id)?.status;

describe("launchReadiness", () => {
  it("lists every check once, in #238 order, each naming its items", () => {
    const { checks } = launchReadiness(ready);
    expect(checks.map((c) => c.id)).toEqual([...LAUNCH_CHECK_IDS]);
    for (const check of checks) expect(check.items, check.id).toMatch(/^\d/);
  });

  it("is ready when everything is answered (pickup only)", () => {
    const readiness = launchReadiness(ready);
    expect(readiness.missing).toEqual([]);
    expect(readiness.ready).toBe(true);
    // home-delivery bits do not apply; the server allowlist is outside the code
    expect(statusOf(ready, "shipping")).toBe("not_needed");
    expect(statusOf(ready, "delivery_vat")).toBe("not_needed");
    expect(statusOf(ready, "back_office_access")).toBe("manual");
  });

  it("refuses placeholder pharmacy details, a stand-in left behind included", () => {
    expect(missingIds({ ...ready, identity: { ...realIdentity, isPlaceholder: true } })).toEqual([
      "pharmacy_details",
      "eu_logo",
    ]);
    // isPlaceholder switched off with a stand-in left: still missing
    expect(
      missingIds({ ...ready, identity: { ...realIdentity, legalName: "[company legal name]" } }),
    ).toContain("pharmacy_details");
  });

  it("refuses the EU logo flag without a registration and the entry's link", () => {
    const notRegistered = { ...ready, decisions: { ...answered, famhpRegistered: false } };
    expect(missingIds(notRegistered)).toEqual(["famhp_registration", "eu_logo"]);
    // registered, but the link is still the stand-in (the site's root)
    const rootLink = { ...ready, euLogoUrl: "https://www.famhp.be" };
    expect(missingIds(rootLink)).toEqual(["famhp_registration", "eu_logo"]);
    // all in, flag off
    const flagOff = {
      ...ready,
      storefront: { ...openShop, flags: { ...openShop.flags, euCommonLogo: false } },
    };
    expect(missingIds(flagOff)).toEqual(["eu_logo"]);
  });

  it("refuses placeholder legal texts, interim mail wording and open privacy groundwork", () => {
    expect(missingIds({ ...ready, decisions: { ...answered, legalTexts: "pending" } })).toEqual([
      "legal_texts",
    ]);
    expect(
      missingIds({ ...ready, decisions: { ...answered, orderMailWording: "interim" } }),
    ).toEqual(["order_mails"]);
    expect(missingIds({ ...ready, decisions: { ...answered, privacyGroundwork: "open" } })).toEqual(
      ["privacy_groundwork"],
    );
    expect(
      missingIds({ ...ready, decisions: { ...answered, paymentMethods: "proposed" } }),
    ).toEqual(["payment_methods"]);
    expect(missingIds({ ...ready, decisions: { ...answered, invoicing: "undecided" } })).toEqual([
      "invoices",
    ]);
  });

  it("refuses a shop without Mollie, with a test key outside staging, or without its return address", () => {
    const sf = (patch: Partial<StorefrontFacts>) => ({
      ...ready,
      storefront: { ...openShop, ...patch },
    });
    expect(missingIds(sf({ mollieKey: "none" }))).toEqual(["payments"]);
    expect(missingIds(sf({ mollieKey: "test" }))).toEqual(["payments"]);
    expect(missingIds(sf({ mollieKey: "test", stage: undefined }))).toEqual(["payments"]);
    expect(missingIds(sf({ mollieKey: "test", stage: "staging" }))).toEqual([]);
    expect(missingIds(sf({ storefrontUrlSet: false }))).toEqual(["payments"]);
  });

  it("refuses an undecided delivery, the cart switched off, and a home-delivery switch that contradicts the decision", () => {
    expect(
      missingIds({ ...ready, decisions: { ...answered, deliveryAtLaunch: "undecided" } }),
    ).toEqual(["delivery_choice"]);
    const sf = (flags: Partial<StorefrontFacts["flags"]>) => ({
      ...ready,
      storefront: { ...openShop, flags: { ...openShop.flags, ...flags } },
    });
    expect(missingIds(sf({ cart: false }))).toEqual(["shop_switches"]);
    // pickup only, but home delivery on
    expect(missingIds(sf({ homeDelivery: true }))).toEqual(["shop_switches"]);
  });

  it("with home delivery: needs the switch, Sendcloud, the amounts, the cold-chain answer and the VAT rate", () => {
    const delivery: LaunchFacts = {
      ...ready,
      decisions: { ...answered, deliveryAtLaunch: "home-delivery" },
      backOffice: { sendcloudConfigured: false, deliveryRatesSet: false },
    };
    expect(missingIds(delivery)).toEqual([
      "shop_switches",
      "shipping",
      "delivery_rates",
      "cold_chain",
      "delivery_vat",
    ]);
    const done: LaunchFacts = {
      ...delivery,
      decisions: {
        ...delivery.decisions,
        coldChainDelivery: "allowed",
        deliveryVatRate: "confirmed",
      },
      storefront: { ...openShop, flags: { ...openShop.flags, homeDelivery: true } },
      backOffice: { sendcloudConfigured: true, deliveryRatesSet: true },
    };
    expect(missingIds(done)).toEqual([]);
    // amounts that failed to load are not "missing", and not "ok" either
    expect(
      statusOf(
        { ...done, backOffice: { sendcloudConfigured: true, deliveryRatesSet: undefined } },
        "delivery_rates",
      ),
    ).toBe("unknown");
  });

  it("marks what the process cannot see as checked elsewhere, never as ok", () => {
    const backOfficeView: LaunchFacts = {
      ...ready,
      storefront: undefined,
      decisions: { ...answered, deliveryAtLaunch: "home-delivery" },
    };
    for (const id of ["eu_logo", "payments", "shop_switches", "shipping", "delivery_rates"]) {
      expect(statusOf(backOfficeView, id), id).toBe("elsewhere");
    }
  });

  it("names no secret: details carry setting names, never their values", () => {
    const facts = { ...ready, storefront: { ...openShop, mollieKey: "none" as const } };
    for (const check of launchReadiness(facts).checks) {
      expect(check.detail, check.id).not.toMatch(/(live|test)_[A-Za-z0-9]{8,}/);
    }
  });
});

describe("today's state (igs-pharma#238: the owner has not answered yet)", () => {
  it("leaves every owner-only answer unanswered: nothing was invented", () => {
    expect(LAUNCH_DECISIONS).toEqual({
      famhpRegistered: false,
      legalTexts: "pending",
      orderMailWording: "interim",
      privacyGroundwork: "open",
      paymentMethods: "proposed",
      deliveryAtLaunch: "undecided",
      coldChainDelivery: "undecided",
      deliveryVatRate: "to-confirm",
      invoicing: "undecided",
    });
    expect(PHARMACY_IDENTITY.isPlaceholder).toBe(true);
  });

  it("so the code alone already blocks the opening on every red item it holds", () => {
    expect(missingIds(codeLaunchFacts())).toEqual([
      "pharmacy_details",
      "famhp_registration",
      "legal_texts",
      "order_mails",
      "privacy_groundwork",
      "payment_methods",
      "delivery_choice",
      "invoices",
    ]);
  });
});

describe("euCommonLogoAllowed", () => {
  it("needs the flag, the real details, the registration and the entry's link", () => {
    expect(euCommonLogoAllowed(true, ready)).toBe(true);
    expect(euCommonLogoAllowed(false, ready)).toBe(false);
    expect(euCommonLogoAllowed(true, { ...ready, identity: PHARMACY_IDENTITY })).toBe(false);
    expect(euCommonLogoAllowed(true, { ...ready, euLogoUrl: "https://www.famhp.be/" })).toBe(false);
    // today: off whatever the flag says
    expect(euCommonLogoAllowed(true)).toBe(false);
  });
});

describe("isFamhpEntryUrl", () => {
  it("accepts a page on a FAMHP site over https, never the site's root or another site", () => {
    expect(isFamhpEntryUrl("https://www.famhp.be/en/x")).toBe(true);
    expect(isFamhpEntryUrl("https://www.fagg.be/nl/x")).toBe(true);
    expect(isFamhpEntryUrl("https://www.afmps.be/fr/x?id=1")).toBe(true);
    expect(isFamhpEntryUrl("https://www.famhp.be")).toBe(false);
    expect(isFamhpEntryUrl("https://www.famhp.be/")).toBe(false);
    expect(isFamhpEntryUrl("http://www.famhp.be/en/x")).toBe(false);
    expect(isFamhpEntryUrl("https://famhp.be.example.com/en/x")).toBe(false);
    expect(isFamhpEntryUrl("https://notfamhp.be/en/x")).toBe(false);
    expect(isFamhpEntryUrl("not a url")).toBe(false);
  });
});

describe("storefront facts and the gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads only the kind of Mollie key, the switches and the stage", () => {
    vi.stubEnv("MOLLIE_API_KEY", `live_${"a".repeat(30)}`);
    vi.stubEnv("STOREFRONT_URL", "https://igs-pharma.example");
    vi.stubEnv("DEPLOY_STAGE", "production");
    vi.stubEnv("NEXT_PUBLIC_FEATURE_CART", "true");
    vi.stubEnv("NEXT_PUBLIC_FEATURE_HOME_DELIVERY", "true");
    vi.stubEnv("NEXT_PUBLIC_FEATURE_EU_COMMON_LOGO", "");
    expect(storefrontLaunchFacts()).toEqual({
      flags: { cart: true, homeDelivery: true, euCommonLogo: false },
      mollieKey: "live",
      storefrontUrlSet: true,
      stage: "production",
    });
    vi.stubEnv("MOLLIE_API_KEY", "test_short");
    expect(storefrontLaunchFacts().mollieKey).toBe("none");
    vi.stubEnv("MOLLIE_API_KEY", `test_${"b".repeat(30)}`);
    expect(storefrontLaunchFacts().mollieKey).toBe("test");
  });

  it("refuses SITE_GATE=off while items are missing, in production by default", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_GATE", "off");
    vi.stubEnv("LAUNCH_CHECK", "");
    const gate = storefrontGate();
    expect(gate).toMatchObject({ closed: true, refused: true, enforced: true });
    expect(gate.readiness.ready).toBe(false);
  });

  it("opens as configured with LAUNCH_CHECK=report, and outside production by default", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_GATE", "off");
    vi.stubEnv("LAUNCH_CHECK", "report");
    expect(storefrontGate()).toMatchObject({ closed: false, refused: false, enforced: false });
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LAUNCH_CHECK", "");
    expect(storefrontGate()).toMatchObject({ closed: false, refused: false, enforced: false });
  });

  it("enforces in development too when asked, and leaves a closed gate closed", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SITE_GATE", "off");
    vi.stubEnv("LAUNCH_CHECK", "enforce");
    expect(storefrontGate()).toMatchObject({ closed: true, refused: true });
    vi.stubEnv("SITE_GATE", "coming-soon");
    expect(storefrontGate()).toMatchObject({ closed: true, refused: false });
  });

  it("throws on an invalid LAUNCH_CHECK like any other setting", () => {
    vi.stubEnv("LAUNCH_CHECK", "maybe");
    expect(() => storefrontGate()).toThrow(/LAUNCH_CHECK/);
  });
});
