// The customer account forms' rules (igs-pharma#115, D-044): field checks, and the mapping of
// Better Auth answers to messages that never tell whether an address has an account.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PASSWORD_MAX,
  VERIFIED_MARKER,
  emailError,
  nameError,
  passwordError,
  requestFailure,
  resetFailure,
  resetToken,
  signInFailure,
  signUpFieldFailure,
  verifyOutcome,
} from "../src/lib/account-forms";

/** An obviously fake reset token that still matches the token shape. */
const FAKE_TOKEN = "fake-token-0000";

const MIN = 12;

describe("field checks", () => {
  it("asks for a name and caps its length", () => {
    expect(nameError("")).toBe("nameRequired");
    expect(nameError("   ")).toBe("nameRequired");
    expect(nameError("An Peeters")).toBeNull();
    expect(nameError("x".repeat(101))).toBe("nameTooLong");
  });

  it("asks for something shaped like an e-mail address", () => {
    expect(emailError("")).toBe("emailRequired");
    expect(emailError("  ")).toBe("emailRequired");
    for (const bad of ["an", "an@", "@example.be", "an@example", "an peeters@example.be"]) {
      expect(emailError(bad), bad).toBe("emailInvalid");
    }
    expect(emailError(`${"a".repeat(250)}@x.be`)).toBe("emailInvalid");
    expect(emailError(" an.peeters@example.be ")).toBeNull();
  });

  it("checks the password by length only, like the server (12 to 128, no composition rules)", () => {
    expect(passwordError("", MIN)).toBe("passwordRequired");
    expect(passwordError("elevenchars", MIN)).toBe("passwordTooShort");
    expect(passwordError("aaaaaaaaaaaa", MIN)).toBeNull();
    expect(passwordError("four words in a row", MIN)).toBeNull();
    expect(passwordError("a".repeat(PASSWORD_MAX), MIN)).toBeNull();
    expect(passwordError("a".repeat(PASSWORD_MAX + 1), MIN)).toBe("passwordTooLong");
  });
});

describe("sign-in failures", () => {
  it("shows one message for every refusal, so an account's existence never shows", () => {
    for (const error of [
      { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" },
      { status: 400, code: "INVALID_EMAIL" },
      { status: 400, code: "FAILED_TO_CREATE_SESSION" },
      { status: 403, code: "FORBIDDEN" },
      { status: 500 },
      {},
      null,
      undefined,
    ]) {
      expect(signInFailure(error), JSON.stringify(error)).toBe("signInFailed");
    }
  });

  it("tells the owner (right password, unconfirmed address) to confirm first", () => {
    expect(signInFailure({ status: 403, code: "EMAIL_NOT_VERIFIED" })).toBe("signInNotVerified");
  });

  it("says when there were too many attempts", () => {
    expect(signInFailure({ status: 429 })).toBe("tooManyAttempts");
    expect(signInFailure({ status: 429, code: "EMAIL_NOT_VERIFIED" })).toBe("tooManyAttempts");
  });
});

describe("sign-up and reset request failures", () => {
  it("puts a refused length or address on its field", () => {
    expect(signUpFieldFailure({ status: 400, code: "PASSWORD_TOO_SHORT" })).toEqual({
      field: "password",
      key: "passwordTooShort",
    });
    expect(signUpFieldFailure({ status: 400, code: "PASSWORD_TOO_LONG" })).toEqual({
      field: "password",
      key: "passwordTooLong",
    });
    expect(signUpFieldFailure({ status: 400, code: "INVALID_EMAIL" })).toEqual({
      field: "email",
      key: "emailInvalid",
    });
    expect(signUpFieldFailure({ status: 422, code: "USER_ALREADY_EXISTS" })).toBeNull();
    expect(signUpFieldFailure(null)).toBeNull();
  });

  it("has only 'too many attempts' and 'try again' otherwise", () => {
    expect(requestFailure({ status: 429 })).toBe("tooManyAttempts");
    expect(requestFailure({ status: 422, code: "USER_ALREADY_EXISTS" })).toBe("requestFailed");
    expect(requestFailure({ status: 500 })).toBe("requestFailed");
    expect(requestFailure(null)).toBe("requestFailed");
  });

  it("maps a refused new password", () => {
    expect(resetFailure({ status: 400, code: "INVALID_TOKEN" })).toBe("resetLinkInvalid");
    expect(resetFailure({ status: 400, code: "PASSWORD_TOO_SHORT" })).toBe("passwordTooShort");
    expect(resetFailure({ status: 400, code: "PASSWORD_TOO_LONG" })).toBe("passwordTooLong");
    expect(resetFailure({ status: 429 })).toBe("tooManyAttempts");
    expect(resetFailure({ status: 500 })).toBe("requestFailed");
  });
});

describe("link landings", () => {
  it("takes the reset token from the query string, only when Better Auth sent a good one", () => {
    expect(resetToken({ token: FAKE_TOKEN })).toBe(FAKE_TOKEN);
    expect(resetToken({})).toBeNull();
    expect(resetToken({ token: "" })).toBeNull();
    expect(resetToken({ token: ["a1b2c3d4e5", "f6g7h8i9j0"] })).toBeNull();
    expect(resetToken({ token: "short" })).toBeNull();
    expect(resetToken({ token: "has spaces in it" })).toBeNull();
    expect(resetToken({ token: "<script>alert(1)</script>" })).toBeNull();
    expect(resetToken({ error: "INVALID_TOKEN" })).toBeNull();
    expect(resetToken({ token: FAKE_TOKEN, error: "INVALID_TOKEN" })).toBeNull();
  });

  it("reads the e-mail confirmation result", () => {
    expect(verifyOutcome({ status: VERIFIED_MARKER })).toBe("confirmed");
    expect(verifyOutcome({ status: VERIFIED_MARKER, error: "INVALID_TOKEN" })).toBe("invalid");
    expect(verifyOutcome({ error: "token_expired" })).toBe("invalid");
    // a naive `?error=` appended to a callbackURL that already has a query string
    expect(verifyOutcome({ status: `${VERIFIED_MARKER}?error=invalid_token` })).toBe("invalid");
    expect(verifyOutcome({ status: [VERIFIED_MARKER, VERIFIED_MARKER] })).toBe("invalid");
    expect(verifyOutcome({})).toBe("pending");
  });
});

describe("account messages", () => {
  const keys = [
    "nameRequired",
    "nameTooLong",
    "emailRequired",
    "emailInvalid",
    "passwordRequired",
    "passwordTooShort",
    "passwordTooLong",
    "signInFailed",
    "signInNotVerified",
    "tooManyAttempts",
    "requestFailed",
    "resetLinkInvalid",
  ];
  for (const locale of ["nl", "fr", "de", "en"]) {
    it(`${locale} has a text for every key the rules return, and the minimum in the hint`, () => {
      const file = join(import.meta.dirname, "..", "..", "..", "packages", "i18n", "messages");
      const messages = JSON.parse(readFileSync(join(file, `${locale}.json`), "utf8")) as {
        account: Record<string, string>;
      };
      for (const key of keys) expect(messages.account[key], `${locale}.${key}`).toBeTruthy();
      expect(messages.account["passwordHint"]).toContain("{min}");
      expect(messages.account["passwordTooShort"]).toContain("{min}");
      expect(messages.account["passwordTooLong"]).toContain("{max}");
    });
  }
});
