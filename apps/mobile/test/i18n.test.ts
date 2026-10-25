import { describe, expect, it } from "vitest";
import { pickLocale, translator } from "../src/i18n";
import { STRINGS } from "../src/i18n/strings";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("texts", () => {
  it("every language has every key, non-empty, with the same placeholders as Dutch", () => {
    const keys = Object.keys(STRINGS.nl) as (keyof typeof STRINGS.nl)[];
    for (const [locale, strings] of Object.entries(STRINGS)) {
      expect(Object.keys(strings).sort(), locale).toEqual([...keys].sort());
      for (const key of keys) {
        expect(strings[key].trim(), `${locale}.${key}`).not.toBe("");
        expect(placeholders(strings[key]), `${locale}.${key}`).toEqual(
          placeholders(STRINGS.nl[key]),
        );
      }
    }
  });

  it("fills placeholders and leaves unknown ones visible", () => {
    const t = translator("en");
    expect(t("page", { page: 2, pages: 5 })).toBe("Page 2 of 5");
    expect(t("searchNoResults")).toBe("No products found for “{q}”.");
  });
});

describe("pickLocale", () => {
  it("takes the first phone language the storefront has, Dutch otherwise", () => {
    expect(pickLocale(["fr-BE", "nl-BE"])).toBe("fr");
    expect(pickLocale(["es-ES", "de-DE"])).toBe("de");
    expect(pickLocale(["en_GB"])).toBe("en");
    expect(pickLocale(["es-ES", null])).toBe("nl");
    expect(pickLocale([])).toBe("nl");
  });
});
