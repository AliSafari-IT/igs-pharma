import { previewSecrets } from "@igs/config";
import { NextResponse } from "next/server";

import {
  PREVIEW_COOKIE,
  PREVIEW_COOKIE_OPTIONS,
  PREVIEW_TTL_SECONDS,
  createPreviewCookie,
  keyMatches,
} from "../../preview";

export const dynamic = "force-dynamic";

/** Longer than any real key: a bigger body is refused before it is compared. */
const MAX_KEY_LENGTH = 512;

/**
 * `POST /preview` (igs-pharma#91): the key comes in the form body, never in a URL, so it stays out
 * of proxy logs and browser history. The right key gets the signed cookie (8 hours) and a 303 to
 * the storefront; anything else a 303 to `/`, the coming-soon page, with no hint. The proxy routes
 * a POST here only while the gate is on and a key is configured; this checks again (fails closed).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secrets = previewSecrets(process.env);
  const home = NextResponse.redirect(new URL("/", request.url), 303);
  if (!secrets) return home;
  let given: FormDataEntryValue | null = null;
  try {
    given = (await request.formData()).get("key");
  } catch {
    return home;
  }
  if (typeof given !== "string" || given.length > MAX_KEY_LENGTH || !keyMatches(given, secrets)) {
    return home;
  }
  const response = NextResponse.redirect(new URL("/nl", request.url), 303);
  response.cookies.set({
    name: PREVIEW_COOKIE,
    value: createPreviewCookie(secrets, Date.now()),
    ...PREVIEW_COOKIE_OPTIONS,
    maxAge: PREVIEW_TTL_SECONDS,
  });
  return response;
}
