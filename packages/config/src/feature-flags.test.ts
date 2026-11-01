import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getFeatureFlags } from "./feature-flags";

describe("home delivery flag", () => {
  const unsetFlags = () => {
    // biome-ignore lint/performance/noDelete: unset, not the string "undefined"
    delete process.env["NEXT_PUBLIC_FEATURE_CART"];
    // biome-ignore lint/performance/noDelete: unset, not the string "undefined"
    delete process.env["NEXT_PUBLIC_FEATURE_HOME_DELIVERY"];
  };
  beforeEach(unsetFlags);
  afterEach(unsetFlags);

  it("is off by default", () => {
    expect(getFeatureFlags().homeDelivery).toBe(false);
  });

  it("needs the cart as well", () => {
    process.env["NEXT_PUBLIC_FEATURE_HOME_DELIVERY"] = "true";
    expect(getFeatureFlags().homeDelivery).toBe(false);
    process.env["NEXT_PUBLIC_FEATURE_CART"] = "true";
    expect(getFeatureFlags().homeDelivery).toBe(true);
  });
});
