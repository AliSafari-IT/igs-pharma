"use server";

import { isDomainError } from "@igs/kernel";
import { requestEarlyAccess } from "@igs/module-identity";
import { redirect } from "next/navigation";

import {
  EARLY_ACCESS_LIMITS,
  type EarlyAccessResult,
  earlyAccessResultFromCode,
} from "../../../lib/early-access-area";
import { accountLocale } from "../../../server/account";
import { requestOrigin, requireCustomer } from "../../../server/customer";
import { withinLimits } from "../../../server/early-access";

/**
 * Asks for early access, or updates the note of the open request (igs-pharma#199). Acts on the
 * signed-in customer only (no user id in the form); answers with a redirect back to the page and a
 * `?result=` key, so it works without JavaScript. Next's Server Action checks (same origin) are the
 * CSRF protection, as for every other storefront form.
 */
export async function askForEarlyAccess(form: FormData): Promise<void> {
  const raw = form.get("locale");
  const locale = accountLocale(typeof raw === "string" ? raw : "");
  const session = await requireCustomer(locale, "/early-access");
  const origin = await requestOrigin();
  const note = form.get("note");

  let result: EarlyAccessResult;
  const allowed = await withinLimits([
    {
      key: `igs:early-access:request:user:${session.actor.id}`,
      limit: EARLY_ACCESS_LIMITS.requestPerUser,
    },
    {
      key: origin.ip ? `igs:early-access:request:ip:${origin.ip}` : null,
      limit: EARLY_ACCESS_LIMITS.requestPerIp,
    },
  ]);
  if (!allowed) {
    result = "rateLimited";
  } else {
    try {
      const { created } = await requestEarlyAccess(
        { note: typeof note === "string" ? note : undefined },
        session.actor,
        { origin },
      );
      result = created ? "requested" : "updated";
    } catch (error) {
      if (!isDomainError(error)) throw error;
      result = earlyAccessResultFromCode(error.code);
    }
  }
  // `redirect` throws: outside the try block
  redirect(`/${locale}/early-access?result=${result}`);
}
