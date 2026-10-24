import { describe, expect, it } from "vitest";
import { formatPrice, formatVatRate, isStandIn, telUrl } from "../src/format";
import { parseSettings } from "../src/settings/parse";

describe("format", () => {
  it("formats euro cents and VAT for the shopper's language", () => {
    expect(formatPrice(1250, "nl")).toMatch(/12,50/);
    expect(formatPrice(1250, "en")).toMatch(/12\.50/);
    expect(formatVatRate(600, "nl")).toMatch(/6\s?%/);
    expect(formatVatRate(2100, "fr")).toMatch(/21\s?%/);
  });

  it("spots stand-in values and makes dialable numbers", () => {
    expect(isStandIn("[phone number]")).toBe(true);
    expect(isStandIn("02 123 45 67")).toBe(false);
    expect(telUrl("070 245 245")).toBe("tel:070245245");
    expect(telUrl("+32 2 123 45 67")).toBe("tel:+3221234567");
  });
});

describe("parseSettings", () => {
  it("keeps known values and falls back to the defaults for anything else", () => {
    expect(parseSettings('{"theme":"dark","language":"fr","largeText":true}')).toEqual({
      theme: "dark",
      language: "fr",
      largeText: true,
    });
    expect(parseSettings('{"theme":"pink","language":"es","largeText":"yes"}')).toEqual({
      theme: "system",
      language: "system",
      largeText: false,
    });
    expect(parseSettings("{")).toEqual({ theme: "system", language: "system", largeText: false });
  });
});
