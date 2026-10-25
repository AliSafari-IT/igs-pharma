import { describe, expect, it } from "vitest";
import { legalUrl } from "../src/config";

describe("legalUrl", () => {
  it("sends privacy and cookies to the landing page, terms to the storefront", () => {
    expect(legalUrl("nl", "privacy")).toBe("https://igs.asafarim.site/privacy/");
    expect(legalUrl("fr", "privacy")).toBe("https://igs.asafarim.site/fr/confidentialite/");
    expect(legalUrl("de", "cookies")).toBe("https://igs.asafarim.site/de/cookies/");
    expect(legalUrl("en", "terms")).toBe("https://igs-pharma.be/en/legal/terms");
  });
});
