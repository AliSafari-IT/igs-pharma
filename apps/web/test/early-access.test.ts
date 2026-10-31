// The early-access pass (igs-pharma#199): signed per user AND per session, short-lived, refreshed by
// a database check. Pure functions: the time is passed in.
import { describe, expect, it } from "vitest";

import {
  PASS_REFRESH_WINDOW_S,
  PASS_TTL_S,
  createPass,
  passSecret,
  relativeRedirect,
  safeReturnPath,
  sessionCookieValue,
  verifyPass,
} from "../src/early-access";

const SECRET = "s".repeat(40);
const USER = "0192f3a4-5b6c-7d8e-9f01-23456789abcd";
const OTHER = "0192f3a4-5b6c-7d8e-9f01-23456789abce";
const SESSION = "token123.signature456";
const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
const MIN = 60_000;
const far = NOW + 24 * 60 * MIN;

describe("createPass / verifyPass", () => {
  it("a fresh pass opens the shop for its own user and session", () => {
    const pass = createPass(SECRET, USER, SESSION, NOW, far);
    expect(verifyPass(SECRET, pass, SESSION, NOW)).toEqual({ userId: USER, fresh: true });
    expect(verifyPass(SECRET, pass, SESSION, NOW + 14 * MIN)).toEqual({
      userId: USER,
      fresh: true,
    });
  });

  it("lives 15 minutes at most, or less when the grant ends sooner", () => {
    const pass = createPass(SECRET, USER, SESSION, NOW, far);
    expect(verifyPass(SECRET, pass, SESSION, NOW + PASS_TTL_S * 1000)).toEqual({
      userId: USER,
      fresh: false,
    });
    const short = createPass(SECRET, USER, SESSION, NOW, NOW + 5 * MIN);
    expect(verifyPass(SECRET, short, SESSION, NOW + 4 * MIN)?.fresh).toBe(true);
    expect(verifyPass(SECRET, short, SESSION, NOW + 5 * MIN)?.fresh).toBe(false);
  });

  it("an ended pass asks for a re-check within the refresh window, then is nothing", () => {
    const pass = createPass(SECRET, USER, SESSION, NOW, far);
    const end = NOW + PASS_TTL_S * 1000;
    expect(
      verifyPass(SECRET, pass, SESSION, end + PASS_REFRESH_WINDOW_S * 1000 - 1000)?.fresh,
    ).toBe(false);
    expect(verifyPass(SECRET, pass, SESSION, end + PASS_REFRESH_WINDOW_S * 1000)).toBeNull();
  });

  it("is worth nothing with another session (copied, or after signing out) or another secret", () => {
    const pass = createPass(SECRET, USER, SESSION, NOW, far);
    expect(verifyPass(SECRET, pass, "token999.other", NOW)).toBeNull();
    expect(verifyPass(SECRET, pass, null, NOW)).toBeNull();
    expect(verifyPass("t".repeat(40), pass, SESSION, NOW)).toBeNull();
    expect(verifyPass(null, pass, SESSION, NOW)).toBeNull();
  });

  it("refuses a tampered pass: another user id, a longer life, a forged or malformed value", () => {
    const pass = createPass(SECRET, USER, SESSION, NOW, far);
    const [version, , expires, signature] = pass.split(".");
    expect(
      verifyPass(SECRET, `${version}.${OTHER}.${expires}.${signature}`, SESSION, NOW),
    ).toBeNull();
    const later = String(Number(expires) + 60);
    expect(verifyPass(SECRET, `${version}.${USER}.${later}.${signature}`, SESSION, NOW)).toBeNull();
    // a pass claiming more life than the server ever grants is refused before its signature
    const long = createPass(SECRET, USER, SESSION, NOW + 60 * MIN, far);
    expect(verifyPass(SECRET, long, SESSION, NOW)).toBeNull();
    for (const bad of [
      undefined,
      "",
      "x",
      "v1.x.1.y",
      `v2.${USER}.${expires}.${signature}`,
      `${pass}.x`,
    ]) {
      expect(verifyPass(SECRET, bad, SESSION, NOW), String(bad)).toBeNull();
    }
  });
});

describe("sessionCookieValue", () => {
  it("reads the customer session cookie, https-prefixed or not", () => {
    const jar = (cookies: Record<string, string>) => (name: string) => cookies[name];
    expect(sessionCookieValue(jar({ "__Secure-igs-c.session_token": "a" }))).toBe("a");
    expect(sessionCookieValue(jar({ "igs-c.session_token": "b" }))).toBe("b");
    // the staff instance's cookie is not a customer session
    expect(sessionCookieValue(jar({ "__Secure-igs.session_token": "c" }))).toBeNull();
    expect(sessionCookieValue(jar({}))).toBeNull();
  });
});

describe("safeReturnPath", () => {
  it("keeps the storefront URL asked for, query and percent-encoding included", () => {
    for (const ok of [
      "/",
      "/nl",
      "/fr/p/1234567",
      "/de/c/pijn-en-koorts/",
      "/en/search",
      "/fr/search?q=aspirine&page=2",
      "/nl/c/%73hoes",
      "/nl/search?q=cr%C3%A8me",
    ]) {
      expect(safeReturnPath(ok), ok).toBe(ok);
    }
  });

  it("refuses anything that could leave the site or resolve elsewhere than checked", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "nl",
      "//evil.example",
      "/\\evil.example",
      "/%5Cevil.example",
      "https://evil.example/",
      "/nl#x",
      "/nl?q=a b",
      "/nl/../x",
      "/./nl",
      "/nl/%2e%2e/x",
      "/nl/%2F%2Fevil",
      "/nl/%zz",
      "/nl//x",
      `/${"a".repeat(600)}`,
    ]) {
      expect(safeReturnPath(bad), String(bad)).toBe("/");
    }
  });
});

describe("passSecret and relativeRedirect", () => {
  it("fails closed without a usable AUTH_SECRET", () => {
    expect(passSecret({ AUTH_SECRET: SECRET })).toBe(SECRET);
    expect(passSecret({ AUTH_SECRET: "short" })).toBeNull();
    expect(passSecret({})).toBeNull();
  });

  it("answers with a relative Location (never the container's address)", () => {
    const res = relativeRedirect("/nl/early-access");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/nl/early-access");
  });
});
