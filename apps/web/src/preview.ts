import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { PreviewSecrets } from "@igs/config";

/**
 * The storefront preview pass (igs-pharma#62). A visitor who presents the secret `IGS_PREVIEW_KEY`
 * at `/preview?key=…` gets a signed cookie that lets them past the site gate for a few hours. The
 * cookie is a VISIBILITY switch, not authorization: it only decides whether the gated storefront
 * pages are shown, and it unlocks nothing else (no back-office, no writes).
 *
 * Pure functions on `node:crypto`; the time is passed in so expiry is testable.
 */

export const PREVIEW_COOKIE = "igs_preview";
/** How long a preview cookie lasts: 8 hours. */
export const PREVIEW_TTL_SECONDS = 8 * 60 * 60;
/**
 * Set by the proxy on the request it forwards, only after the cookie verified, so pages can show the
 * preview banner. The proxy deletes any value the client sent.
 */
export const PREVIEW_HEADER = "x-igs-preview";

const VERSION = "v1";

/**
 * Whether `given` is the preview key, in constant time. Both sides are hashed first, so the
 * comparison takes the same time whatever their lengths and however much of them matches.
 */
export function keyMatches(given: string, secrets: PreviewSecrets): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secrets.key).digest();
  return timingSafeEqual(a, b);
}

/**
 * The signature of an expiry. The preview key is part of what is signed (never of what is sent), so
 * rotating either `IGS_PREVIEW_KEY` or `AUTH_SECRET` ends every cookie issued before.
 */
function sign(secrets: PreviewSecrets, expires: number): Buffer {
  return createHmac("sha256", secrets.secret)
    .update(`igs-preview/${VERSION}/${expires}/${secrets.key}`)
    .digest();
}

/** A new cookie value, valid for `PREVIEW_TTL_SECONDS` from `now` (milliseconds). */
export function createPreviewCookie(secrets: PreviewSecrets, now: number): string {
  const expires = Math.floor(now / 1000) + PREVIEW_TTL_SECONDS;
  return `${VERSION}.${expires}.${sign(secrets, expires).toString("base64url")}`;
}

/** Whether `value` is a cookie this server signed that has not expired at `now` (milliseconds). */
export function verifyPreviewCookie(
  secrets: PreviewSecrets | null,
  value: string | undefined,
  now: number,
): boolean {
  if (!secrets || !value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [version, expiresText, signature] = parts as [string, string, string];
  if (version !== VERSION || !/^[0-9]{1,12}$/.test(expiresText)) return false;
  const expires = Number(expiresText);
  const seconds = Math.floor(now / 1000);
  // expired, or claiming more life than this server ever grants
  if (expires <= seconds || expires > seconds + PREVIEW_TTL_SECONDS) return false;
  const given = Buffer.from(signature, "base64url");
  const expected = sign(secrets, expires);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
