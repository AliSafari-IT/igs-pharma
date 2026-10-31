/**
 * RBAC catalogue (B-02, T-016). **Code is canonical**: the roles, permissions and role → permission
 * map below are seeded into `identity.roles|permissions|role_permissions` by a migration generated
 * from this file (`tools/db/gen-rbac-seed.mjs`), and a real-Postgres drift test fails when the two
 * disagree. At boot each process loads the mapping from the database (`loadRbacCatalogue()` in
 * `@igs/module-identity`), which installs it with `setRbacCatalogue()` (`./install.ts`).
 *
 * This file has no imports on purpose: the seed generator runs it with plain Node (type stripping).
 */

export const PERMISSIONS = {
  orders: {
    /** Staff-wide access to orders. Customers hold `readOwn` instead. */
    read: "orders.read",
    /** Customer access to their OWN orders: handlers check it with `ctx.authorizeResource`. */
    readOwn: "orders.read.own",
    create: "orders.create",
    /** Staff: fulfilment steps of a paid order. */
    manage: "orders.order.manage",
    reviewDecide: "orders.review.decide",
    /**
     * Staff (igs-pharma#156): ask for the refund of a closed, paid order; the worker executes it. An
     * order that holds a medicine also needs `reviewDecide` (a pharmacist), never implied by owner.
     */
    refundRequest: "orders.refund.request",
    /**
     * Staff (igs-pharma#202): set the home-delivery price and the free-delivery threshold. The owner
     * and the pharmacist-titular only; every change also needs a fresh passkey check.
     */
    deliverySettingsManage: "orders.delivery_settings.manage",
    /**
     * System-only (igs-pharma#116): attach a provider payment to an order's payment and record what
     * the provider says about it (paid confirms the stock holds; failed cancels the order). Held by
     * the webhook, the "pay now" route and the worker's reconciliation, never by a person.
     */
    paymentManage: "orders.payment.manage",
  },
  catalog: {
    read: "catalog.read",
    manage: "catalog.manage",
    /** Back-office: see every product (drafts and archived ones too) and the category tree. */
    productsRead: "catalog.products.read",
    /** Back-office: create and edit products, brands, categories and content; change product status. */
    productsManage: "catalog.products.manage",
    /**
     * Pharmacist-only (D-034): set a product's regulated fields (type, legal status, VAT class,
     * pharmacist review, minimum age), activate a medicine and approve medicine content.
     */
    productsRegulatedManage: "catalog.products.regulated.manage",
    /** Storefront: read active products and the category tree, never drafts (igs-pharma#62). */
    storefrontRead: "catalog.storefront.read",
    /**
     * Pharmacist-only (igs-pharma#187): start and end a product's stop-sale. A recall does it in its
     * own transaction; while one is active the product is not storefront-visible.
     */
    stopSalesManage: "catalog.stop_sales.manage",
  },
  inventory: {
    /** Back-office: on-hand stock and the movement ledger (igs-pharma#53). */
    stockRead: "inventory.stock.read",
    /** Back-office: import stock counts and adjust stock with a reason. */
    stockManage: "inventory.stock.manage",
    /** Storefront: whether a product is in stock, never how many (igs-pharma#62). */
    availabilityRead: "inventory.availability.read",
    /**
     * System-only (igs-pharma#99): create, confirm, release and consume stock reservations, and expire
     * lapsed holds. Held by the future checkout actor and the worker's expiry job, never by staff
     * (staff release a reservation with `inventory.stock.manage`).
     */
    reservationManage: "inventory.reservation.manage",
    /** Pharmacist-only (igs-pharma#164): quarantine a lot (never sellable) and release it. */
    lotsQuarantine: "inventory.lots.quarantine",
    /** Titular-only (igs-pharma#164): the shop-wide expiry buffer (how close to expiry a lot stops selling). */
    settingsManage: "inventory.settings.manage",
    /**
     * Pharmacist-only (igs-pharma#187, REQ-SAF-01): start a recall (its lots quarantined, the product's
     * sale stopped) and end it.
     */
    recallsManage: "inventory.recalls.manage",
  },
  pricing: {
    /** Back-office: a product's web price, its VAT part, scheduled changes and history (igs-pharma#59). */
    priceRead: "pricing.price.read",
    /** Back-office: set a product's price from now or schedule a change. */
    priceManage: "pricing.price.manage",
    /** Storefront: the CURRENT price of an active product, never its history or schedule (igs-pharma#96). */
    storefrontRead: "pricing.storefront.read",
  },
  privacy: {
    /** Back-office: a subject's current consents and their history (igs-pharma#58). */
    consentRead: "privacy.consent.read",
    /** Back-office: record a consent given or withdrawn in store, by phone or by post. */
    consentRecord: "privacy.consent.record",
    /** Back-office: the register of data-subject requests and their deadlines. */
    dsrRead: "privacy.dsr.read",
    /** Back-office: log a data-subject request and move it through its statuses. */
    dsrManage: "privacy.dsr.manage",
    /** System actors only: the retention job deletes expired ledger rows (igs-pharma#88). */
    retentionPurge: "privacy.retention.purge",
    /** Customer: read and change their OWN consents (source `storefront`); the subject is the actor's e-mail. */
    selfConsentManage: "privacy.self.consent.manage",
    /** Customer: ask for their OWN data (access) or its erasure; staff process the request. */
    selfDsrCreate: "privacy.self.dsr.create",
  },
  /**
   * A customer's own account (igs-pharma#114, D-044). `.self.` permissions are customer-only: every command
   * behind them acts on `actor.id` and takes no user id in its input, so there is nothing to scope with
   * `authorizeResource`.
   */
  account: {
    selfRead: "account.self.read",
    selfUpdate: "account.self.update",
  },
  /**
   * Early access to the gated storefront (igs-pharma#199): before launch, approved customers see the
   * shop. Staff decide requests with `earlyAccessManage` (owner only); a customer asks for, reads and
   * uses their OWN access with `earlyAccessSelf` (it acts on `actor.id`, no user id in its input).
   */
  storefront: {
    earlyAccessManage: "storefront.early_access.manage",
    earlyAccessSelf: "storefront.early_access.self.request",
  },
  staff: {
    invite: "staff.invite",
    /** Grant/revoke non-pharmacist roles; suspend, reactivate and delete users. */
    manage: "staff.manage",
  },
  pharmacy: {
    /** Grant/revoke `pharmacist` and `pharmacist_titular` (Q7): only the titular holds it (D-030). */
    pharmacistsManage: "pharmacy.pharmacists.manage",
  },
  identity: {
    /** Create the first owner or titular pharmacist (bootstrap CLI, 36b). System actors only. */
    bootstrap: "identity.bootstrap",
    /** Audit sign-in factor changes reported by Better Auth (36b). System actors only. */
    securityEventsRecord: "identity.security_events.record",
    /** Ask for a verification, reset or notice mail (igs-pharma#114): the Better Auth callbacks. System actors only. */
    mailRequest: "identity.mail.request",
  },
} as const;

/** Values of every group, distributed over the union (indexing a union by `keyof` yields `never`). */
type GroupValues<G> = G extends unknown ? G[keyof G] : never;

export type Permission = GroupValues<(typeof PERMISSIONS)[keyof typeof PERMISSIONS]>;

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS).flatMap((group) =>
  Object.values(group),
);

/**
 * `system` roles (36b) are held by system actors only (the bootstrap CLI, the Better Auth security
 * event hook), never by a user: a grant requires the role kind to equal the user kind, and users are
 * `customer` or `staff`.
 */
export type RoleKind = "customer" | "staff" | "system";

export interface RoleDefinition {
  readonly kind: RoleKind;
  readonly description: string;
}

/** Every role. Staff roles hold only `.any` permissions; customer roles only `.own` ones (T-016). */
export const ROLES = {
  owner: { kind: "staff", description: "Pharmacy owner: runs the business, manages staff" },
  pharmacist_titular: {
    kind: "staff",
    description: "Titular pharmacist: legally responsible, manages pharmacists",
  },
  pharmacist: { kind: "staff", description: "Pharmacist: decides on pharmaceutical reviews" },
  pharmacy_assistant: { kind: "staff", description: "Pharmacy assistant" },
  customer_service: { kind: "staff", description: "Customer service" },
  content_editor: { kind: "staff", description: "Catalogue content editor" },
  customer: { kind: "customer", description: "Webshop customer" },
  system_bootstrap: { kind: "system", description: "Bootstrap CLI: creates the first owner" },
  system_auth: {
    kind: "system",
    description: "Better Auth hooks: records sign-in factor changes and requests account mails",
  },
  system_storefront: {
    kind: "system",
    description: "Storefront preview: reads active products, prices and availability (no writes)",
  },
  system_seed: {
    kind: "system",
    description:
      "Synthetic seed CLI: loads fake catalogue, stock, price, privacy and order data (staging and development only)",
  },
  system_maintenance: {
    kind: "system",
    description: "Worker maintenance jobs: purges personal data past its retention period",
  },
  system_reservations: {
    kind: "system",
    description:
      "Stock reservations: the checkout reserves, confirms, releases and consumes; the worker expires lapsed holds",
  },
  system_payments: {
    kind: "system",
    description:
      "Payments: the storefront's pay route and webhook and the worker's reconciliation record what the provider says",
  },
} as const satisfies Record<string, RoleDefinition>;

export type RoleKey = keyof typeof ROLES;

export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];

/**
 * Pharmacist-only permissions (REQ-PHC-01/05): never implied by `owner` or any administrative
 * role. A person who is both owner and pharmacist simply holds both roles (D-030).
 */
export const PHARMACIST_ONLY: readonly Permission[] = [
  PERMISSIONS.orders.reviewDecide,
  PERMISSIONS.pharmacy.pharmacistsManage,
  PERMISSIONS.catalog.productsRegulatedManage,
  PERMISSIONS.inventory.lotsQuarantine,
  PERMISSIONS.inventory.settingsManage,
  PERMISSIONS.inventory.recallsManage,
  PERMISSIONS.catalog.stopSalesManage,
];

/** Roles that only a holder of `pharmacy.pharmacists.manage` may grant or revoke (Q7). */
export const PHARMACIST_ROLES: readonly RoleKey[] = ["pharmacist", "pharmacist_titular"];

/** System-only permissions (36b): held by `system` roles, never implied by `owner`. */
export const SYSTEM_ONLY: readonly Permission[] = [
  ...Object.values(PERMISSIONS.identity),
  PERMISSIONS.privacy.retentionPurge,
  // the storefront's narrow price read (#96): staff read prices with `pricing.price.read`
  PERMISSIONS.pricing.storefrontRead,
  PERMISSIONS.inventory.reservationManage,
  PERMISSIONS.orders.paymentManage,
];

/** The canonical role → permission map (seeded by migration; checked against the DB at boot). */
export const ROLE_PERMISSIONS: Readonly<Record<RoleKey, readonly Permission[]>> = {
  // EXPLICIT (#64 C7): a permission added later reaches the owner only when it is listed here, so a
  // forgotten one can never leak to the owner. `catalogue.test.ts` pins this exact set. Not here on
  // purpose: the pharmacist- and system-only permissions (D-030) and customer permissions
  // (`orders.create`, `.own`). The two storefront reads stay: staff use the same queries to see every
  // product, the storefront actor only the visible ones (inventory/catalog tests rely on it).
  owner: [
    PERMISSIONS.orders.read,
    PERMISSIONS.orders.manage,
    PERMISSIONS.orders.refundRequest,
    PERMISSIONS.orders.deliverySettingsManage,
    PERMISSIONS.catalog.read,
    PERMISSIONS.catalog.manage,
    PERMISSIONS.catalog.productsRead,
    PERMISSIONS.catalog.productsManage,
    PERMISSIONS.catalog.storefrontRead,
    PERMISSIONS.inventory.stockRead,
    PERMISSIONS.inventory.stockManage,
    PERMISSIONS.inventory.availabilityRead,
    PERMISSIONS.pricing.priceRead,
    PERMISSIONS.pricing.priceManage,
    PERMISSIONS.privacy.consentRead,
    PERMISSIONS.privacy.consentRecord,
    PERMISSIONS.privacy.dsrRead,
    PERMISSIONS.privacy.dsrManage,
    PERMISSIONS.staff.invite,
    PERMISSIONS.staff.manage,
    PERMISSIONS.storefront.earlyAccessManage,
  ],
  pharmacist_titular: [
    PERMISSIONS.orders.read,
    PERMISSIONS.orders.manage,
    PERMISSIONS.orders.reviewDecide,
    PERMISSIONS.orders.refundRequest,
    PERMISSIONS.orders.deliverySettingsManage,
    PERMISSIONS.catalog.read,
    PERMISSIONS.catalog.productsRead,
    PERMISSIONS.catalog.productsRegulatedManage,
    PERMISSIONS.inventory.stockRead,
    PERMISSIONS.inventory.stockManage,
    PERMISSIONS.inventory.lotsQuarantine,
    PERMISSIONS.inventory.recallsManage,
    PERMISSIONS.catalog.stopSalesManage,
    PERMISSIONS.inventory.settingsManage,
    PERMISSIONS.pharmacy.pharmacistsManage,
  ],
  // asafarim-docs:ventures/igs-pharma/04-product/pharmacy-platform-backoffice.md: the inventory screens belong to pharmacists and assistants
  pharmacist: [
    PERMISSIONS.orders.read,
    PERMISSIONS.orders.manage,
    PERMISSIONS.orders.reviewDecide,
    PERMISSIONS.orders.refundRequest,
    PERMISSIONS.catalog.read,
    PERMISSIONS.catalog.productsRead,
    PERMISSIONS.catalog.productsRegulatedManage,
    PERMISSIONS.inventory.stockRead,
    PERMISSIONS.inventory.stockManage,
    PERMISSIONS.inventory.lotsQuarantine,
    PERMISSIONS.inventory.recallsManage,
    PERMISSIONS.catalog.stopSalesManage,
  ],
  pharmacy_assistant: [
    PERMISSIONS.orders.read,
    PERMISSIONS.orders.manage,
    PERMISSIONS.catalog.read,
    PERMISSIONS.catalog.productsRead,
    PERMISSIONS.inventory.stockRead,
    PERMISSIONS.inventory.stockManage,
  ],
  customer_service: [PERMISSIONS.orders.read],
  // asafarim-docs:ventures/igs-pharma/04-product/pharmacy-platform-backoffice.md: the catalogue screens belong to the content editor
  content_editor: [
    PERMISSIONS.catalog.read,
    PERMISSIONS.catalog.manage,
    PERMISSIONS.catalog.productsRead,
    PERMISSIONS.catalog.productsManage,
  ],
  customer: [
    PERMISSIONS.orders.create,
    PERMISSIONS.orders.readOwn,
    PERMISSIONS.catalog.read,
    PERMISSIONS.account.selfRead,
    PERMISSIONS.account.selfUpdate,
    PERMISSIONS.privacy.selfConsentManage,
    PERMISSIONS.privacy.selfDsrCreate,
    PERMISSIONS.storefront.earlyAccessSelf,
  ],
  system_bootstrap: [PERMISSIONS.identity.bootstrap],
  system_auth: [PERMISSIONS.identity.securityEventsRecord, PERMISSIONS.identity.mailRequest],
  system_storefront: [
    PERMISSIONS.catalog.storefrontRead,
    PERMISSIONS.inventory.availabilityRead,
    PERMISSIONS.pricing.storefrontRead,
  ],
  system_seed: [
    PERMISSIONS.catalog.productsRead,
    PERMISSIONS.catalog.productsManage,
    PERMISSIONS.catalog.productsRegulatedManage,
    PERMISSIONS.inventory.stockRead,
    PERMISSIONS.inventory.stockManage,
    PERMISSIONS.pricing.priceRead,
    PERMISSIONS.pricing.priceManage,
    PERMISSIONS.privacy.consentRead,
    PERMISSIONS.privacy.consentRecord,
    PERMISSIONS.privacy.dsrRead,
    PERMISSIONS.privacy.dsrManage,
    PERMISSIONS.orders.read,
    PERMISSIONS.orders.manage,
    PERMISSIONS.orders.reviewDecide,
  ],
  system_maintenance: [PERMISSIONS.privacy.retentionPurge],
  system_reservations: [PERMISSIONS.inventory.reservationManage],
  system_payments: [PERMISSIONS.orders.paymentManage],
};

/** One row of `identity.role_permissions`. */
export interface RolePermissionRow {
  readonly roleKey: string;
  readonly permissionKey: string;
}

/** The code catalogue as `role_permissions` rows, sorted (for the seed and the drift check). */
export function codeRolePermissions(): RolePermissionRow[] {
  return ROLE_KEYS.flatMap((roleKey) =>
    ROLE_PERMISSIONS[roleKey].map((permissionKey) => ({ roleKey, permissionKey })),
  ).sort((a, b) =>
    a.roleKey === b.roleKey
      ? a.permissionKey.localeCompare(b.permissionKey)
      : a.roleKey.localeCompare(b.roleKey),
  );
}

const pair = (row: RolePermissionRow) => `${row.roleKey}:${row.permissionKey}`;

/** Pairs present in code but not in `rows` (`missing`) and the reverse (`extra`), sorted. */
export function rbacDrift(rows: readonly RolePermissionRow[]): {
  missing: string[];
  extra: string[];
} {
  const inDb = new Set(rows.map(pair));
  const inCode = new Set(codeRolePermissions().map(pair));
  return {
    missing: [...inCode].filter((p) => !inDb.has(p)).sort(),
    extra: [...inDb].filter((p) => !inCode.has(p)).sort(),
  };
}
