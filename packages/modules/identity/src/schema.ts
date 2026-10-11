import { newId } from "@igs/db/ids";
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Identity module tables (Better Auth core + twoFactor + passkey, REQ-SEC-01).
 * Owned by this module (D-001). Postgres schema `identity`; plural snake_case table names
 * per domain-model §1; UUIDv7 ids generated app-side (D-003); timestamptz everywhere.
 * RBAC (B-02, T-016): `roles`, `permissions`, `role_permissions` (seeded by migration from the
 * code catalogue) and `user_roles` (runtime assignments, scoped by `location_id`; NULL = all).
 *
 * Better Auth resolves tables by model name, so `usePlural: true` is set on the adapter and
 * the exported keys below are the plural model names (users, sessions, accounts, …).
 *
 * Generated from Better Auth 1.7.7 (`npx auth@1.7.7 generate`, then adapted). When upgrading
 * better-auth or its plugins, re-run the generator and diff against this file.
 *
 * Boundary (D-011): this module owns the identity tables AND the identity commands (role grants,
 * user status; `./commands.ts`), plus loading the RBAC catalogue (`./rbac.ts`). `@igs/auth`
 * imports it (adapter schema, actor resolution); it must NEVER import `@igs/auth`, which would
 * create a dependency cycle. It depends on `@igs/kernel` and the leaf `@igs/rbac` only.
 */
export const identity = pgSchema("identity");

/** Case-insensitive text; requires the `citext` extension (first migration). */
const citext = customType<{ data: string }>({
  dataType: () => "citext",
});

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => newId());

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

/** Allowed values of the profile columns (text + CHECK, not pg enums: cheaper to evolve). */
export const USER_LOCALES = ["nl", "fr", "de", "en"] as const;
export const USER_KINDS = ["customer", "staff"] as const;
/** Role kinds: the user kinds plus `system` (roles held only by system actors, 36b). */
export const ROLE_KINDS = [...USER_KINDS, "system"] as const;
export const USER_STATUSES = ["active", "suspended", "deleted"] as const;
export const IDENTITY_ASSURANCE = ["none", "email", "itsme_high"] as const;

export type UserLocale = (typeof USER_LOCALES)[number];
export type UserKind = (typeof USER_KINDS)[number];
export type RoleKind = (typeof ROLE_KINDS)[number];
export type UserStatus = (typeof USER_STATUSES)[number];
export type IdentityAssurance = (typeof IDENTITY_ASSURANCE)[number];

const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(", ")})`);

export const users = identity.table(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: citext("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    twoFactorEnabled: boolean("two_factor_enabled").default(false),
    // T-016: never client-settable (Better Auth additionalFields with input: false)
    locale: text("locale").$type<UserLocale>().default("nl").notNull(),
    kind: text("kind").$type<UserKind>().default("customer").notNull(),
    status: text("status").$type<UserStatus>().default("active").notNull(),
    identityAssurance: text("identity_assurance")
      .$type<IdentityAssurance>()
      .default("none")
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check("users_locale_check", oneOf("locale", USER_LOCALES)),
    check("users_kind_check", oneOf("kind", USER_KINDS)),
    check("users_status_check", oneOf("status", USER_STATUSES)),
    check("users_identity_assurance_check", oneOf("identity_assurance", IDENTITY_ASSURANCE)),
  ],
);

export const sessions = identity.table(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    /**
     * 36b: when this session proved a second factor (passkey with user verification, or a TOTP
     * code). NULL = not verified; the kernel rejects staff on such a session (`kernel.mfa_required`).
     * Written by the `@igs/auth` hooks only (Better Auth `additionalFields` with `input: false`), and
     * cleared on the user's other sessions when a factor is removed.
     */
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
    /**
     * 36b: when this session was started by redeeming a bootstrap enrolment link. Only such a
     * session may enrol a staff user's FIRST factor; cleared once the session is MFA-verified.
     * Server-owned like `mfaVerifiedAt` (`input: false`).
     */
    enrolmentAt: timestamp("enrolment_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = identity.table(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

export const verifications = identity.table(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

export const twoFactors = identity.table(
  "two_factors",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [
    index("two_factors_secret_idx").on(t.secret),
    index("two_factors_user_id_idx").on(t.userId),
  ],
);

export const passkeys = identity.table(
  "passkeys",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    aaguid: text("aaguid"),
    createdAt: timestamp("created_at", { withTimezone: true }),
  },
  (t) => [
    index("passkeys_user_id_idx").on(t.userId),
    index("passkeys_credential_id_idx").on(t.credentialID),
  ],
);

// ── RBAC (T-016) ────────────────────────────────────────────────────────────────────────────────

/** Code-owned catalogue (`@igs/rbac`): rows are seeded by migration only (see the drift test). */
export const roles = identity.table(
  "roles",
  {
    key: text("key").primaryKey(),
    kind: text("kind").$type<RoleKind>().notNull(),
    description: text("description").notNull(),
  },
  () => [check("roles_kind_check", oneOf("kind", ROLE_KINDS))],
);

export const permissions = identity.table("permissions", {
  key: text("key").primaryKey(),
});

export const rolePermissions = identity.table(
  "role_permissions",
  {
    roleKey: text("role_key")
      .notNull()
      .references(() => roles.key, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleKey, t.permissionKey] })],
);

/**
 * Runtime role assignments. `location_id` NULL = every location (Phase 1 has one pharmacy); the
 * FK to `locations` is added fix-forward with B-06. Never cached across requests (T-016 Q2).
 */
export const userRoles = identity.table(
  "user_roles",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleKey: text("role_key")
      .notNull()
      .references(() => roles.key),
    locationId: uuid("location_id"),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("user_roles_user_role_location_unique")
      .on(t.userId, t.roleKey, t.locationId)
      .nullsNotDistinct(),
    index("user_roles_user_id_idx").on(t.userId),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  twoFactors: many(twoFactors),
  passkeys: many(passkeys),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const twoFactorsRelations = relations(twoFactors, ({ one }) => ({
  user: one(users, { fields: [twoFactors.userId], references: [users.id] }),
}));

export const passkeysRelations = relations(passkeys, ({ one }) => ({
  user: one(users, { fields: [passkeys.userId], references: [users.id] }),
}));
