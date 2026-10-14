import {
  type ResolvedActor,
  type SessionResolution,
  resolveSession,
  sessionTokenFromCookies,
} from "@igs/auth";
import type { Origin } from "@igs/kernel";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { isInteractiveRequest } from "./activity";
import { ensureAuthConfigured } from "./kernel";

/**
 * The session of THIS request (memoised per request with React `cache()`, never across requests),
 * after the staff session limits (#95): an interactive request restarts the idle clock, a
 * background one does not, and a session over its 8-hour or 30-minute limit is gone (`ended`).
 */
const currentSession = cache(async (): Promise<SessionResolution | null> => {
  const requestHeaders = await headers();
  // signed out: no auth setup, no database (the root layout asks on every page, 404s included)
  if (!sessionTokenFromCookies(requestHeaders.get("cookie"))) return null;
  ensureAuthConfigured();
  return resolveSession(requestHeaders, { interactive: isInteractiveRequest(requestHeaders) });
});

/**
 * The signed-in person for THIS request: roles, kind and, since 36b, whether this session proved a
 * second factor. `null` when signed out or when the staff session has just ended.
 */
export const currentActor = cache(
  async (): Promise<ResolvedActor | null> => (await currentSession())?.actor ?? null,
);

/** Where a signed-out request goes: the sign-in page, saying why when the session just ended. */
export async function signInPath(): Promise<string> {
  const ended = (await currentSession())?.ended;
  return ended ? `/sign-in?reason=${ended}` : "/sign-in";
}

/** Staff who still have to set up or confirm 2-step login (the kernel refuses them anything else). */
export const needsTwoStep = (actor: ResolvedActor) => actor.kind === "staff" && !actor.mfaVerified;

/**
 * The actor for a back-office page or Server Action: signed out → /sign-in, 2-step login still
 * to do → /setup (36b). Permissions are still the kernel's call, per command and query.
 */
export async function requireStaffActor(): Promise<ResolvedActor> {
  const actor = await currentActor();
  if (!actor) redirect(await signInPath());
  if (needsTwoStep(actor)) redirect("/setup");
  return actor;
}

/** The caller's `origin` for the audit port, which hashes it (T-006b); handlers never see it. */
export async function requestOrigin(): Promise<Origin> {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
    userAgent: h.get("user-agent") ?? undefined,
  };
}
