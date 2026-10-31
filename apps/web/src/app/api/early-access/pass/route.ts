import { appEnv, parseEnvFor, siteGateEnabled, siteGateEnv } from "@igs/config";
import { locales } from "@igs/i18n";
import { isDomainError } from "@igs/kernel";
import { issueEarlyAccessPass } from "@igs/module-identity";
import { type NextRequest, NextResponse } from "next/server";

import {
  PASS_COOKIE,
  PASS_COOKIE_OPTIONS,
  createPass,
  passSecret,
  safeReturnPath,
  sessionCookieValue,
} from "../../../../early-access";
import { EARLY_ACCESS_LIMITS, type EarlyAccessResult } from "../../../../lib/early-access-area";
import { currentCustomer, requestOrigin } from "../../../../server/customer";
import { withinLimits } from "../../../../server/early-access";

export const dynamic = "force-dynamic";

/** A 303 with a RELATIVE Location (never built from `request.url`, igs-pharma#199). */
function seeOther(path: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { location: path, "cache-control": "no-store" },
  });
}

/** The early-access page in the language of `next` (`/fr/…` → `/fr/early-access`), or the default. */
function earlyAccessPage(next: string, result?: EarlyAccessResult): string {
  const first = next.split("/")[1] ?? "";
  const prefix = (locales as readonly string[]).includes(first) ? `/${first}` : "";
  return `${prefix}/early-access${result ? `?result=${result}` : ""}`;
}

function withoutPass(response: NextResponse): NextResponse {
  response.cookies.set({ name: PASS_COOKIE, value: "", ...PASS_COOKIE_OPTIONS, maxAge: 0 });
  return response;
}

/**
 * `GET /api/early-access/pass?next=/nl/…` (igs-pharma#199): issues or refreshes the early-access pass.
 * The grant is read from the database (`issueEarlyAccessPass`, audited) on every call; the pass is
 * bound to the caller's session cookie and lives 15 minutes at most. Granted: the pass and a 303 to
 * `next` (a storefront path only). Otherwise the pass is cleared and the visitor lands on the
 * early-access page, which says why. Limited per account and per address. A GET because the proxy
 * sends a browser here when its pass runs out; it changes nothing but the caller's own cookie.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const next = safeReturnPath(request.nextUrl.searchParams.get("next"));
  if (!siteGateEnabled(parseEnvFor(appEnv.extend(siteGateEnv.shape)))) {
    // the shop is open to everyone: no pass needed
    return withoutPass(seeOther(next));
  }
  const secret = passSecret(process.env);
  const session = sessionCookieValue((name) => request.cookies.get(name)?.value);
  const customer = secret && session ? await currentCustomer() : null;
  if (!secret || !session || !customer) return withoutPass(seeOther(earlyAccessPage(next)));

  const origin = await requestOrigin();
  const allowed = await withinLimits([
    {
      key: `igs:early-access:pass:user:${customer.actor.id}`,
      limit: EARLY_ACCESS_LIMITS.passPerUser,
    },
    {
      key: origin.ip ? `igs:early-access:pass:ip:${origin.ip}` : null,
      limit: EARLY_ACCESS_LIMITS.passPerIp,
    },
  ]);
  if (!allowed) return seeOther(earlyAccessPage(next, "rateLimited"));

  let outcome: { granted: boolean; until: Date | null };
  try {
    outcome = await issueEarlyAccessPass({}, customer.actor, { origin });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = { granted: false, until: null };
  }
  if (!outcome.granted || !outcome.until) {
    return withoutPass(seeOther(earlyAccessPage(next, "passRefused")));
  }
  const now = Date.now();
  const response = seeOther(next);
  response.cookies.set({
    name: PASS_COOKIE,
    value: createPass(secret, customer.actor.id, session, now, outcome.until.getTime()),
    ...PASS_COOKIE_OPTIONS,
  });
  return response;
}
