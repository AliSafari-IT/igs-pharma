import { createHash, randomBytes } from "node:crypto";

import type { Db } from "@igs/db";
import { and, count, eq, gt, isNotNull, ne } from "drizzle-orm";

import { passkeys, sessions, twoFactors, users, verifications } from "./schema";

/**
 * Second-factor facts (36b). Better Auth records them through the `@igs/auth` hooks, which call these
 * functions; the kernel enforces them (`Actor.mfaVerified`, `kernel.mfa_required`). Identity owns the
 * tables, so the SQL lives here (D-011), like `sessionAllowed`.
 */

/** Anything that can read and write (the pool, or a transaction). */
type Executor = Pick<Db, "select" | "update" | "delete" | "insert">;
type Reader = Pick<Db, "select">;

export type MfaMethod = "passkey" | "totp";

export interface MfaFactors {
  readonly passkeys: number;
  /** A TOTP secret the user confirmed with a code (`two_factor_enabled` and a verified row). */
  readonly totp: boolean;
}

/** The user's enrolled second factors. A TOTP secret that was never confirmed does not count. */
export async function mfaFactors(db: Reader, userId: string): Promise<MfaFactors> {
  const [[keys], [totp]] = await Promise.all([
    db.select({ n: count() }).from(passkeys).where(eq(passkeys.userId, userId)),
    db
      .select({ id: twoFactors.id })
      .from(twoFactors)
      .innerJoin(users, eq(users.id, twoFactors.userId))
      .where(
        and(
          eq(twoFactors.userId, userId),
          eq(twoFactors.verified, true),
          eq(users.twoFactorEnabled, true),
        ),
      )
      .limit(1),
  ]);
  return { passkeys: keys?.n ?? 0, totp: totp !== undefined };
}

export const factorCount = (factors: MfaFactors) => factors.passkeys + (factors.totp ? 1 : 0);

/** The user's kind (`staff` rules apply to staff only), or `null` for an unknown user. */
export async function userKind(db: Reader, userId: string): Promise<"customer" | "staff" | null> {
  const [row] = await db.select({ kind: users.kind }).from(users).where(eq(users.id, userId));
  return row?.kind ?? null;
}

/** Whether `sessionId` (of `userId`) has proved a second factor. */
export async function sessionMfaVerified(
  db: Reader,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        isNotNull(sessions.mfaVerifiedAt),
      ),
    );
  return row !== undefined;
}

/** Marks a session as having proved a second factor (`at` = when). */
export async function markSessionMfaVerified(
  db: Executor,
  sessionId: string,
  at: Date = new Date(),
): Promise<void> {
  await db.update(sessions).set({ mfaVerifiedAt: at }).where(eq(sessions.id, sessionId));
}

/**
 * After a factor is removed: every OTHER session of the user loses its verified mark, so a device
 * that verified with the removed factor must verify again (Q5). `keepSessionId` is the session that
 * made the change (it re-proved nothing, but it is the person acting right now).
 */
export async function clearOtherSessionsMfa(
  db: Executor,
  userId: string,
  keepSessionId: string | null,
): Promise<void> {
  await db
    .update(sessions)
    .set({ mfaVerifiedAt: null })
    .where(
      and(
        eq(sessions.userId, userId),
        isNotNull(sessions.mfaVerifiedAt),
        ...(keepSessionId ? [ne(sessions.id, keepSessionId)] : []),
      ),
    );
}

// ── enrolment links (bootstrap CLI) ────────────────────────────────────────────────────────────

/** Lifetime of an enrolment link (Q4: single use, 15 minutes). */
export const ENROLMENT_TTL_MS = 15 * 60 * 1000;

const ENROLMENT_PREFIX = "staff-enrolment:";

const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** A fresh enrolment token: 32 random bytes, base64url. Only its SHA-256 is ever stored. */
export function newEnrolmentToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Stores the hash of `token` for `userId`, valid until `expiresAt`. */
export async function storeEnrolmentToken(
  db: Executor,
  userId: string,
  token: string,
  expiresAt: Date,
): Promise<void> {
  await db.insert(verifications).values({
    identifier: `${ENROLMENT_PREFIX}${hashToken(token)}`,
    value: userId,
    expiresAt,
  });
}

/**
 * Consumes an enrolment token: deletes its row and returns the user id, in ONE statement, so two
 * concurrent redemptions cannot both succeed. `null` for an unknown, used or expired token.
 */
export async function redeemEnrolmentToken(
  db: Executor,
  token: string,
  now: Date = new Date(),
): Promise<string | null> {
  if (token.length === 0 || token.length > 200) return null;
  const [row] = await db
    .delete(verifications)
    .where(
      and(
        eq(verifications.identifier, `${ENROLMENT_PREFIX}${hashToken(token)}`),
        gt(verifications.expiresAt, now),
      ),
    )
    .returning({ userId: verifications.value });
  return row?.userId ?? null;
}
