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
    reviewDecide: "orders.review.decide",
  },
  catalog: {
    read: "catalog.read",
    manage: "catalog.manage",
    /** Back-office: see every product (drafts and archived ones too) and the category tree. */
    productsRead: "catalog.products.read",
    /** Back-office: create and edit products, brands, categories and content; change product status. */
    productsManage: "catalog.products.manage",
  },
  inventory: {
    /** Back-office: on-hand stock and the movement ledger (igs-pharma#53). */
    stockRead: "inventory.stock.read",
    /** Back-office: import stock counts and adjust stock with a reason. */
    stockManage: "inventory.stock.manage",
  },
  pricing: {
    /** Back-office: a product's web price, its VAT part, scheduled changes and history (igs-pharma#59). */
    priceRead: "pricing.price.read",
    /** Back-office: set a product's price from now or schedule a change. */
    priceManage: "pricing.price.manage",
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
  system_auth: { kind: "system", description: "Better Auth hooks: records sign-in factor changes" },
  system_seed: {
    kind: "system",
    description:
      "Synthetic seed CLI: loads fake catalogue, stock, price and privacy data (staging and development only)",
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
];

/** Roles that only a holder of `pharmacy.pharmacists.manage` may grant or revoke (Q7). */
export const PHARMACIST_ROLES: readonly RoleKey[] = ["pharmacist", "pharmacist_titular"];

/** System-only permissions (36b): held by `system` roles, never implied by `owner`. */
export const SYSTEM_ONLY: readonly Permission[] = Object.values(PERMISSIONS.identity);

const isOwnScoped = (permission: string) => permission.endsWith(".own");

/** The canonical role → permission map (seeded by migration; checked against the DB at boot). */
export const ROLE_PERMISSIONS: Readonly<Record<RoleKey, readonly Permission[]>> = {
  owner: ALL_PERMISSIONS.filter(
    (p) => !PHARMACIST_ONLY.includes(p) && !SYSTEM_ONLY.includes(p) && !isOwnScoped(p),
  ),
  pharmacist_titular: [
    PERMISSIONS.orders.read,
    PERMISSIONS.orders.reviewDecide,
    PERMISSIONS.catalog.read,
    PERMISSIONS.catalog.productsRead,
    PERMISSIONS.inventory.stockRead,
    PERMISSIONS.inventory.stockManage,
    PERMISSIONS.pharmacy.pharmacistsManage,
  ],
  // pharmacy-platform-backoffice.md: the inventory screens belong to pharmacists and assistants
  pharmacist: [
    PERMISSIONS.orders.read,
    PERMISSIONS.orders.reviewDecide,
    PERMISSIONS.catalog.read,
    PERMISSIONS.catalog.productsRead,
    PERMISSIONS.inventory.stockRead,
    PERMISSIONS.inventory.stockManage,
  ],
  pharmacy_assistant: [
    PERMISSIONS.orders.read,
    PERMISSIONS.catalog.read,
    PERMISSIONS.catalog.productsRead,
    PERMISSIONS.inventory.stockRead,
    PERMISSIONS.inventory.stockManage,
  ],
  customer_service: [PERMISSIONS.orders.read],
  // pharmacy-platform-backoffice.md: the catalogue screens belong to the content editor
  content_editor: [
    PERMISSIONS.catalog.read,
    PERMISSIONS.catalog.manage,
    PERMISSIONS.catalog.productsRead,
    PERMISSIONS.catalog.productsManage,
  ],
  customer: [PERMISSIONS.orders.create, PERMISSIONS.orders.readOwn, PERMISSIONS.catalog.read],
  system_bootstrap: [PERMISSIONS.identity.bootstrap],
  system_auth: [PERMISSIONS.identity.securityEventsRecord],
  system_seed: [
    PERMISSIONS.catalog.productsRead,
    PERMISSIONS.catalog.productsManage,
    PERMISSIONS.inventory.stockRead,
    PERMISSIONS.inventory.stockManage,
    PERMISSIONS.pricing.priceRead,
    PERMISSIONS.pricing.priceManage,
    PERMISSIONS.privacy.consentRead,
    PERMISSIONS.privacy.consentRecord,
    PERMISSIONS.privacy.dsrRead,
    PERMISSIONS.privacy.dsrManage,
  ],
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
