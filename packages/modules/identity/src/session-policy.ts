import type { Db } from "@igs/db";
import { and, eq } from "drizzle-orm";

import { sessions, users } from "./schema";

type Executor = Pick<Db, "select" | "update" | "delete">;
type Reader = Pick<Db, "select">;

/**
 * Staff session limits (igs-pharma#95, security-architecture §2). Both are enforced on the server,
 * on every request that resolves an actor; a browser timer is only a convenience.
 */

/** A staff session ends 8 hours after the person signed in, whatever happens. Never extended. */
export const STAFF_SESSION_MAX_MS = 8 * 60 * 60 * 1000;

/** A staff session with no interactive request for 30 minutes ends. */
export const STAFF_IDLE_MS = 30 * 60 * 1000;

/** Why a session is over: `expired` = past the 8-hour limit, `idle` = 30 minutes without activity. */
export type SessionEnd = "expired" | "idle";

/**
 * The verdict for one session at `now`. The 8-hour limit counts from `createdAt` (the sign-in) and
 * nothing moves it: not a refresh, not a fresh passkey check. The idle clock counts from the last
 * interactive request (`lastActivityAt`, or the sign-in when there has been none). Exactly at a
 * limit the session is over (8 h − 1 ms is accepted, 8 h is refused). The absolute limit wins when
 * both apply.
 */
export function sessionEnd(
  session: { readonly createdAt: Date; readonly lastActivityAt: Date | null },
  now: Date,
): SessionEnd | null {
  if (now.getTime() - session.createdAt.getTime() >= STAFF_SESSION_MAX_MS) return "expired";
  const lastActivity = session.lastActivityAt ?? session.createdAt;
  if (now.getTime() - lastActivity.getTime() >= STAFF_IDLE_MS) return "idle";
  return null;
}

/**
 * Applies the limits to `sessionId` of `userId`: an over-limit staff session is deleted (so it can
 * never be revived by any later request) and its reason returned; otherwise `null`. With `touch`
 * the session's idle clock restarts at `now`: pass it ONLY for an interactive request the person
 * made, never for a background one (the browser's own session check, prefetches, polling).
 * Customer sessions are not limited here (Phase 1b).
 */
export async function enforceSessionLimits(
  db: Executor,
  options: { userId: string; sessionId: string; now: Date; touch: boolean },
): Promise<SessionEnd | null> {
  const [row] = await db
    .select({
      createdAt: sessions.createdAt,
      lastActivityAt: sessions.lastActivityAt,
      kind: users.kind,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, options.sessionId), eq(sessions.userId, options.userId)));
  if (!row || row.kind !== "staff") return null;
  const ended = sessionEnd(row, options.now);
  if (ended) {
    await db.delete(sessions).where(eq(sessions.id, options.sessionId));
    return ended;
  }
  if (options.touch) {
    await db
      .update(sessions)
      .set({ lastActivityAt: options.now })
      .where(eq(sessions.id, options.sessionId));
  }
  return null;
}

/** Whether `sessionId` is still inside both limits at `now`, changing nothing (a read-only peek). */
export async function sessionWithinLimits(
  db: Reader,
  options: { userId: string; sessionId: string; now: Date },
): Promise<boolean> {
  const [row] = await db
    .select({
      createdAt: sessions.createdAt,
      lastActivityAt: sessions.lastActivityAt,
      kind: users.kind,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, options.sessionId), eq(sessions.userId, options.userId)));
  if (!row) return false;
  return row.kind !== "staff" || sessionEnd(row, options.now) === null;
}

/**
 * The session a cookie's token names, for the limits check only (the token is looked up as given;
 * a wrong one finds nothing, and what is found is merely checked against the limits).
 */
export async function sessionByToken(
  db: Reader,
  token: string,
): Promise<{ readonly id: string; readonly userId: string } | null> {
  const [row] = await db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(eq(sessions.token, token));
  return row ?? null;
}
