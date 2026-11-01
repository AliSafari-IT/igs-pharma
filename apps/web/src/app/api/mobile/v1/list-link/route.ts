import { authEnv } from "@igs/config";
import { getFeatureFlags } from "@igs/config/feature-flags";
import { NextResponse } from "next/server";

import { passSecret } from "../../../../../early-access";
import { LIST_LINK_PARAM, createListToken, listCnks } from "../../../../../list-link";
import { mobileError } from "../../../../../server/mobile-api";
import { localeOf } from "../../../../../server/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A list request is a few hundred bytes; anything far larger is refused unread. */
const MAX_BODY_BYTES = 4096;

/**
 * `POST /api/mobile/v1/list-link` with `{"cnks": ["1234567", …], "locale": "nl"}` (igs-pharma#218):
 * the website link that opens the Android app's list on the cart, `{"url", "expiresAt"}`. The link is
 * signed and lives 15 minutes; nothing is stored. `400 invalid_input` for a bad list (1 to 30 CNKs of
 * 7 digits) or locale, `503 unavailable` while the cart is off or the storefront address is not set.
 */
export async function POST(request: Request) {
  const storefront = authEnv.shape.STOREFRONT_URL.safeParse(process.env["STOREFRONT_URL"]);
  const secret = passSecret(process.env);
  if (!getFeatureFlags().cart || !storefront.success || !storefront.data || !secret) {
    return mobileError("unavailable", 503);
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return mobileError("invalid_input", 400);
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return mobileError("invalid_input", 400);
    body = JSON.parse(text);
  } catch {
    return mobileError("invalid_input", 400);
  }
  const input = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const cnks = listCnks(input["cnks"]);
  const locale = input["locale"] === undefined ? "nl" : localeOf(String(input["locale"]));
  if (!cnks || !locale) return mobileError("invalid_input", 400);

  const { token, expiresAt } = createListToken(secret, cnks, Date.now());
  const url = new URL(`/${locale}/cart/from-list`, storefront.data);
  url.searchParams.set(LIST_LINK_PARAM, token);
  return NextResponse.json(
    { url: url.toString(), expiresAt: expiresAt.toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
