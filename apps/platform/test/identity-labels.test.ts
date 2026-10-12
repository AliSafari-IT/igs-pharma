import { describe, expect, it } from "vitest";

import { identityErrorMessage } from "../src/components/identity-labels";

const PROTOTYPE_KEYS = ["toString", "constructor", "hasOwnProperty", "__proto__", "valueOf"];

describe("identityErrorMessage", () => {
  it("explains the D-035 codes in words", () => {
    expect(identityErrorMessage("identity.last_holder_protected")).toMatch(/last active holder/);
    expect(identityErrorMessage("identity.pharmacist_access_requires_titular")).toMatch(
      /pharmacist-titular/,
    );
  });

  it("falls back to a generic text, never to an Object.prototype member", () => {
    const fallback = "That didn't work. Try again.";
    expect(identityErrorMessage(undefined)).toBe(fallback);
    expect(identityErrorMessage("identity.unknown")).toBe(fallback);
    for (const key of PROTOTYPE_KEYS) expect(identityErrorMessage(key)).toBe(fallback);
  });
});
