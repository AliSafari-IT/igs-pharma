import { createHash, randomBytes } from "node:crypto";

import type { Db } from "@igs/db";
import { and, count, desc, eq, gt, isNotNull, like, ne, or } from "drizzle-orm";

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

/** When `sessionId` (of `userId`) last proved a second factor, or `null` if it has not. */
export async function sessionMfaVerifiedAt(
  db: Reader,
  userId: string,
  sessionId: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ at: sessions.mfaVerifiedAt })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  return row?.at ?? null;
}

/** When `sessionId` (of `userId`) last passed a PASSKEY check, or `null` (igs-pharma#100). */
export async function sessionPasskeyCheckedAt(
  db: Reader,
  userId: string,
  sessionId: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ at: sessions.passkeyCheckedAt })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  return row?.at ?? null;
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

/**
 * Marks a session as having proved a second factor (`at` = when). It also ends the session's
 * enrolment origin: from now on it adds factors as a verified session, not through the link.
 */
export async function markSessionMfaVerified(
  db: Executor,
  sessionId: string,
  at: Date = new Date(),
): Promise<void> {
  await db
    .update(sessions)
    .set({ mfaVerifiedAt: at, enrolmentAt: null })
    .where(eq(sessions.id, sessionId));
}

/**
 * A passkey check on `sessionId` (igs-pharma#100): the session is verified AND freshly proven. Called
 * only after `/passkey/verify-authentication`; the other ways of verifying use `markSessionMfaVerified`.
 */
export async function markSessionPasskeyChecked(
  db: Executor,
  sessionId: string,
  at: Date = new Date(),
): Promise<void> {
  await db
    .update(sessions)
    .set({ mfaVerifiedAt: at, passkeyCheckedAt: at, enrolmentAt: null })
    .where(eq(sessions.id, sessionId));
}

/** What a session row's clocks and proofs were before a second-factor check replaced it. */
export type PriorSession = {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly lastActivityAt: Date | null;
  readonly expiresAt: Date;
  readonly passkeyCheckedAt: Date | null;
};

/** The session row `sessionId` as it is now, for `rotateSession` (read BEFORE the endpoint runs). */
export async function readPriorSession(
  db: Reader,
  sessionId: string,
): Promise<PriorSession | null> {
  const [row] = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      createdAt: sessions.createdAt,
      lastActivityAt: sessions.lastActivityAt,
      expiresAt: sessions.expiresAt,
      passkeyCheckedAt: sessions.passkeyCheckedAt,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  return row ?? null;
}

/**
 * A second-factor check made inside a live session (igs-pharma#100): Better Auth answers it with a
 * NEW session (new token, so a stolen old cookie dies) and deletes the old one. The browser moves to
 * the new one, but the clocks stay the OLD session's (`created_at`, `last_activity_at`,
 * `expires_at`), so the 8-hour limit never restarts. The new session is verified now;
 * `passkeyCheckedAt` is `at` after a passkey check, the old session's own value after a TOTP or
 * backup code (those never make a proof fresh).
 */
export async function rotateSession(
  db: Db,
  options: { prior: PriorSession; newId: string; at: Date; passkeyChecked: boolean },
): Promise<void> {
  const { prior } = options;
  // ONE transaction (igs-pharma#110): the new row takes the old clocks and the old row goes, or
  // neither happens, so a failure never leaves a new session with a fresh 8-hour clock
  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({
        createdAt: prior.createdAt,
        lastActivityAt: prior.lastActivityAt,
        expiresAt: prior.expiresAt,
        mfaVerifiedAt: options.at,
        passkeyCheckedAt: options.passkeyChecked ? options.at : prior.passkeyCheckedAt,
        enrolmentAt: null,
      })
      .where(eq(sessions.id, options.newId));
    await tx.delete(sessions).where(eq(sessions.id, prior.id));
  });
}

/** Records that `sessionId` was started by redeeming an enrolment link (`/enrolment/redeem`). */
export async function markSessionFromEnrolment(
  db: Executor,
  sessionId: string,
  at: Date = new Date(),
): Promise<void> {
  await db.update(sessions).set({ enrolmentAt: at }).where(eq(sessions.id, sessionId));
}

/**
 * Whether `sessionId` (of `userId`) came from an enrolment link and has not verified since: the only
 * session that may enrol a staff user's first factor.
 */
export async function sessionFromEnrolment(
  db: Reader,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNotNull(sessions.enrolmentAt)),
    );
  return row !== undefined;
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
    .set({ mfaVerifiedAt: null, passkeyCheckedAt: null })
    .where(
      and(
        eq(sessions.userId, userId),
        or(isNotNull(sessions.mfaVerifiedAt), isNotNull(sessions.passkeyCheckedAt)),
        ...(keepSessionId ? [ne(sessions.id, keepSessionId)] : []),
      ),
    );
}

// ── removing factors (igs-pharma#90) ──────────────────────────────────────────────────────────

/**
 * Deletes one passkey of `userId`. Returns whether it existed: a passkey of another user is never
 * touched (the same ownership rule as Better Auth's `/passkey/delete-passkey`).
 */
export async function deletePasskey(
  db: Executor,
  userId: string,
  passkeyId: string,
): Promise<boolean> {
  const removed = await db
    .delete(passkeys)
    .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)))
    .returning({ id: passkeys.id });
  return removed.length > 0;
}

/**
 * Deletes the newest passkey of `userId`: the undo of a registration whose response carried no id
 * (#90 C5). Returns whether one was deleted.
 */
export async function deleteNewestPasskey(db: Executor, userId: string): Promise<boolean> {
  const [newest] = await db
    .select({ id: passkeys.id })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(desc(passkeys.createdAt))
    .limit(1);
  return newest ? deletePasskey(db, userId, newest.id) : false;
}

/** Turns TOTP off for `userId`: the secret and backup codes go, as `/two-factor/disable` does. */
export async function disableTotp(db: Executor, userId: string): Promise<void> {
  await db.delete(twoFactors).where(eq(twoFactors.userId, userId));
  await db.update(users).set({ twoFactorEnabled: false }).where(eq(users.id, userId));
}

/** Deletes every second factor of `userId` (all passkeys and TOTP): a sign-in reset. */
export async function deleteAllFactors(db: Executor, userId: string): Promise<void> {
  await db.delete(passkeys).where(eq(passkeys.userId, userId));
  await disableTotp(db, userId);
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

/** Deletes every unused enrolment token of `userId` (a re-issued link replaces them). */
export async function deleteEnrolmentTokens(db: Executor, userId: string): Promise<void> {
  await db
    .delete(verifications)
    .where(
      and(like(verifications.identifier, `${ENROLMENT_PREFIX}%`), eq(verifications.value, userId)),
    );
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
