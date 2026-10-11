import { type ResolvedActor, resolveActor } from "@igs/auth";
import { headers } from "next/headers";
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
