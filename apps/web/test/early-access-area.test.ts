import { describe, expect, it } from "vitest";

import en from "../../../packages/i18n/messages/en.json";
import {
  EARLY_ACCESS_LIMITS,
  EARLY_ACCESS_RESULTS,
  earlyAccessResultFromCode,
  earlyAccessResultKey,
  earlyAccessResultOf,
  isEarlyAccessSuccess,
} from "../src/lib/early-access-area";

describe("early-access page results (#199)", () => {
  it("accepts only the keys the page and the pass route send", () => {
    for (const result of EARLY_ACCESS_RESULTS) expect(earlyAccessResultOf({ result })).toBe(result);
    for (const bad of ["", "nope", "Requested", "<script>"]) {
      expect(earlyAccessResultOf({ result: bad }), bad).toBeNull();
    }
    expect(earlyAccessResultOf({ result: ["requested", "failed"] })).toBeNull();
  });

  it("every result has a message, and only a sent or updated request is good news", () => {
    for (const result of EARLY_ACCESS_RESULTS) {
      expect(en.earlyAccess, result).toHaveProperty(earlyAccessResultKey(result));
    }
    expect(EARLY_ACCESS_RESULTS.filter(isEarlyAccessSuccess)).toEqual(["requested", "updated"]);
  });

  it("maps the module's refusals, anything else is a plain failure", () => {
    expect(earlyAccessResultFromCode("identity.early_access.too_soon")).toBe("tooSoon");
    expect(earlyAccessResultFromCode("identity.early_access.already_granted")).toBe(
      "alreadyGranted",
    );
    expect(earlyAccessResultFromCode("identity.email_not_verified")).toBe("notVerified");
    expect(earlyAccessResultFromCode("kernel.validation_failed")).toBe("failed");
  });

  it("limits asking more tightly than the pass check", () => {
    expect(EARLY_ACCESS_LIMITS.requestPerUser.max).toBeLessThan(
      EARLY_ACCESS_LIMITS.passPerUser.max,
    );
  });
});
