import { type ResolvedActor, resolveActor } from "@igs/auth";
import type { Origin } from "@igs/kernel";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { ensureAuthConfigured } from "./kernel";

/**
 * The signed-in person for THIS request (memoised per request with React `cache()`, never across
 * requests): roles, kind and, since 36b, whether this session proved a second factor.
 */
export const currentActor = cache(async (): Promise<ResolvedActor | null> => {
  ensureAuthConfigured();
  return resolveActor(await headers());
});

/** Staff who still have to set up or confirm 2-step login (the kernel refuses them anything else). */
export const needsTwoStep = (actor: ResolvedActor) => actor.kind === "staff" && !actor.mfaVerified;

/**
 * The actor for a back-office page or Server Action: signed out → /sign-in, 2-step login still
 * to do → /setup (36b). Permissions are still the kernel's call, per command and query.
 */
export async function requireStaffActor(): Promise<ResolvedActor> {
  const actor = await currentActor();
  if (!actor) redirect("/sign-in");
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
