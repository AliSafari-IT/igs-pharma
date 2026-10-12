// The preview cookie (igs-pharma#62): its signature, its expiry and the constant-time key check.
import { describe, expect, it } from "vitest";

import {
  PREVIEW_TTL_SECONDS,
  createPreviewCookie,
  keyMatches,
  verifyPreviewCookie,
} from "../src/preview";

const secrets = { key: "k".repeat(40), secret: "s".repeat(40) };
const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);
const HOUR = 3_600_000;

describe("keyMatches", () => {
  it("accepts the key and nothing else", () => {
    expect(keyMatches(secrets.key, secrets)).toBe(true);
    for (const wrong of ["", "k", `${secrets.key}x`, secrets.key.slice(1), "K".repeat(40)]) {
      expect(keyMatches(wrong, secrets), wrong).toBe(false);
    }
  });
});

describe("the preview cookie", () => {
  it("verifies until its 8 hours are over, and not after", () => {
    const cookie = createPreviewCookie(secrets, NOW);
    expect(verifyPreviewCookie(secrets, cookie, NOW)).toBe(true);
    expect(verifyPreviewCookie(secrets, cookie, NOW + 7 * HOUR)).toBe(true);
    expect(verifyPreviewCookie(secrets, cookie, NOW + 8 * HOUR - 1000)).toBe(true);
    expect(verifyPreviewCookie(secrets, cookie, NOW + 8 * HOUR)).toBe(false);
    expect(verifyPreviewCookie(secrets, cookie, NOW + 9 * HOUR)).toBe(false);
    expect(PREVIEW_TTL_SECONDS).toBe(8 * 60 * 60);
  });

  it("never contains the key or the signing secret", () => {
    const cookie = createPreviewCookie(secrets, NOW);
    expect(cookie).not.toContain(secrets.key);
    expect(cookie).not.toContain(secrets.secret);
    expect(cookie).toMatch(/^v1\.[0-9]+\.[A-Za-z0-9_-]+$/);
  });

  it("refuses a tampered cookie: another expiry, signature or version", () => {
    const [version, expires, signature] = createPreviewCookie(secrets, NOW).split(".") as [
      string,
      string,
      string,
    ];
    const longer = String(Number(expires) + 3600);
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
    for (const forged of [
      `${version}.${longer}.${signature}`,
      `${version}.${expires}.${flipped}`,
      `v2.${expires}.${signature}`,
      `${version}.${expires}.`,
      `${version}.${expires}`,
      `${version}.${expires}.${signature}.extra`,
      `${version}.${"9".repeat(13)}.${signature}`,
      `${version}.-1.${signature}`,
      "",
      "garbage",
    ]) {
      expect(verifyPreviewCookie(secrets, forged, NOW), forged).toBe(false);
    }
  });

  it("refuses a cookie claiming more life than this server grants", () => {
    // signed correctly, but a year long: only possible with the secret, still not honoured
    const cookie = createPreviewCookie(secrets, NOW + 365 * 24 * HOUR);
    expect(verifyPreviewCookie(secrets, cookie, NOW)).toBe(false);
  });

  it("is bound to both secrets: rotating the key or AUTH_SECRET ends it", () => {
    const cookie = createPreviewCookie(secrets, NOW);
    expect(verifyPreviewCookie({ ...secrets, key: "j".repeat(40) }, cookie, NOW)).toBe(false);
    expect(verifyPreviewCookie({ ...secrets, secret: "t".repeat(40) }, cookie, NOW)).toBe(false);
  });

  it("verifies nothing when the preview is off or the cookie is absent", () => {
    const cookie = createPreviewCookie(secrets, NOW);
    expect(verifyPreviewCookie(null, cookie, NOW)).toBe(false);
    expect(verifyPreviewCookie(secrets, undefined, NOW)).toBe(false);
  });
});
