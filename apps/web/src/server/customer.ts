import { type CustomerSession, resolveCustomerSession } from "@igs/auth";
import type { Origin } from "@igs/kernel";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { ensureKernelConfigured } from "./kernel";

/**
 * The signed-in customer of THIS request (memoised per request with React `cache()`, never across
 * requests), or `null`: no session, a suspended account, or a staff cookie (it never works here).
 */
export const currentCustomer = cache(async (): Promise<CustomerSession | null> => {
  await ensureKernelConfigured();
  return resolveCustomerSession(await headers());
});

/** The customer for an account page or Server Action: signed out goes to the sign-in page. */
export async function requireCustomer(locale: string, next?: string): Promise<CustomerSession> {
  const session = await currentCustomer();
  if (!session) {
    const query = next ? `?next=${encodeURIComponent(next)}` : "";
    redirect(`/${locale}/account/sign-in${query}`);
  }
  return session;
}

/** The caller's `origin` for the audit port, which hashes it (T-006b); handlers never see it. */
export async function requestOrigin(): Promise<Origin> {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
    userAgent: h.get("user-agent") ?? undefined,
  };
}
