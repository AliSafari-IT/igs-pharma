// The signed-in account pages' pure rules (igs-pharma#115 PR C): the result keys the Server Actions
// redirect with, the "return to" path after signing in again, and the header's cookie check.
import { describe, expect, it } from "vitest";

import {
  ACCOUNT_RESULTS,
  hasCustomerSessionCookie,
  isSuccessResult,
  resultMessageKey,
  resultOf,
  safeNext,
} from "../src/lib/account-area";

describe("resultOf", () => {
  it("accepts only the keys the pages send", () => {
    for (const result of ACCOUNT_RESULTS) expect(resultOf({ result })).toBe(result);
    for (const bad of ["", "nope", "ProfileSaved", "<script>"]) {
      expect(resultOf({ result: bad }), bad).toBeNull();
    }
    expect(resultOf({})).toBeNull();
    expect(resultOf({ result: ["requested", "failed"] })).toBeNull();
  });

  it("every result has a message key and a tone", () => {
    expect(resultMessageKey("profileSaved")).toBe("resultProfileSaved");
    expect(resultMessageKey("freshRequired")).toBe("resultFreshRequired");
    expect(ACCOUNT_RESULTS.filter(isSuccessResult)).toEqual([
      "profileSaved",
      "consentSaved",
      "requested",
    ]);
  });
});

describe("safeNext", () => {
  it("allows the account area and the early-access page (#199) only", () => {
    for (const ok of [
      "/account",
      "/account/security",
      "/account/privacy",
      "/account/profile",
      "/early-access",
    ]) {
      expect(safeNext(ok), ok).toBe(ok);
    }
  });

  it("refuses anything that could leave the site or the account area", () => {
    for (const bad of [
      "",
      "/",
      "/nl",
      "//evil.example",
      "https://evil.example/account",
      "/account/",
      "/account//evil.example",
      "/account/../admin",
      "/account/security?x=1",
      "/account/security#top",
      "/accounts",
      "/early-access/x",
      "/early-access?x=1",
      "/account\\evil",
      "javascript:alert(1)",
    ]) {
      expect(safeNext(bad), bad).toBeNull();
    }
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext(["/account"])).toBeNull();
  });
});

describe("hasCustomerSessionCookie", () => {
  it("finds the customer session cookie, with or without the Secure prefix", () => {
    expect(hasCustomerSessionCookie("igs-c.session_token=abc.def")).toBe(true);
    expect(hasCustomerSessionCookie("a=1; __Secure-igs-c.session_token=abc.def; b=2")).toBe(true);
  });

  it("ignores everything else, staff cookies included", () => {
    expect(hasCustomerSessionCookie(null)).toBe(false);
    expect(hasCustomerSessionCookie("")).toBe(false);
    expect(hasCustomerSessionCookie("igs-c.session_token=")).toBe(false);
    expect(hasCustomerSessionCookie("better-auth.session_token=abc")).toBe(false);
    expect(hasCustomerSessionCookie("x-igs-c.session_token=abc")).toBe(false);
  });
});
