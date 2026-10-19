"use server";

import { FreshSessionRequiredError, requireFreshSession } from "@igs/auth";
import { isDomainError } from "@igs/kernel";
import { updateOwnProfile } from "@igs/module-identity";
import {
  CONSENT_PURPOSES,
  SELF_DSR_TYPES,
  recordOwnConsent,
  requestOwnDsr,
} from "@igs/module-privacy";
import { redirect } from "next/navigation";

import { type AccountResult, CONSENT_POLICY_VERSION } from "../../../lib/account-area";
import { accountLocale } from "../../../server/account";
import { requestOrigin, requireCustomer } from "../../../server/customer";

/**
 * The signed-in account pages' Server Actions (igs-pharma#115 PR C). Each one answers with a redirect
 * back to its page and a `?result=` key, so the forms work without JavaScript. Every command acts on
 * the signed-in customer only: no user id travels in a form.
 */

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** `redirect` throws, so it is always called OUTSIDE a try block. */
function back(locale: string, page: string, result: AccountResult): never {
  redirect(`/${locale}/account/${page}?result=${result}`);
}

/** The page's locale and the signed-in customer, or a 404 (flag off, unknown locale) / the sign-in page. */
async function start(form: FormData, page: string) {
  const locale = accountLocale(text(form, "locale"));
  const session = await requireCustomer(locale, `/account/${page}`);
  return { locale, session, origin: await requestOrigin() };
}

export async function saveProfile(form: FormData): Promise<void> {
  const { locale, session, origin } = await start(form, "profile");
  let result: AccountResult = "profileSaved";
  try {
    await updateOwnProfile(
      { name: text(form, "name"), locale: text(form, "emailLocale") },
      session.actor,
      { origin },
    );
  } catch (error) {
    if (!isDomainError(error)) throw error;
    result = error.code === "kernel.validation_failed" ? "profileInvalid" : "failed";
  }
  back(locale, "profile", result);
}

export async function saveConsent(form: FormData): Promise<void> {
  const { locale, session, origin } = await start(form, "privacy");
  const purpose = text(form, "purpose");
  let result: AccountResult = "consentSaved";
  try {
    if (!(CONSENT_PURPOSES as readonly string[]).includes(purpose)) throw new Error("purpose");
    await recordOwnConsent(
      { purpose, granted: text(form, "granted") === "true", policyVersion: CONSENT_POLICY_VERSION },
      session.actor,
      { origin },
    );
  } catch (error) {
    if (!isDomainError(error) && !(error instanceof Error && error.message === "purpose")) {
      throw error;
    }
    result = "failed";
  }
  back(locale, "privacy", result);
}

/**
 * A copy of the data, or its erasure. Both need a sign-in at most ten minutes old (D-044): the
 * kernel has no session age, so the rule is checked here, before the command.
 */
export async function requestData(form: FormData): Promise<void> {
  const { locale, session, origin } = await start(form, "privacy");
  const type = text(form, "type");
  let result: AccountResult = "requested";
  try {
    requireFreshSession(session);
    if (!(SELF_DSR_TYPES as readonly string[]).includes(type)) throw new Error("type");
    await requestOwnDsr({ type }, session.actor, { origin });
  } catch (error) {
    if (error instanceof FreshSessionRequiredError) result = "freshRequired";
    else if (isDomainError(error))
      result = error.code === "privacy.dsr_already_open" ? "alreadyOpen" : "failed";
    else if (error instanceof Error && error.message === "type") result = "failed";
    else throw error;
  }
  back(locale, "privacy", result);
}
