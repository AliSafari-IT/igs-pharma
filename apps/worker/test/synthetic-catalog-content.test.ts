// What the synthetic catalogue may contain (igs-pharma#50, filled up for a demo in igs-pharma#112):
// clearly fake names, no prescription products, legal statuses that fit their type, and enough
// active products per top-level category that the storefront does not look empty. No database.
import { legalStatusFits } from "@igs/module-catalog";
import { describe, expect, it } from "vitest";

import { CATEGORIES, PRODUCTS } from "../src/synthetic-catalog";
import { SCHEDULED_INDEX } from "../src/synthetic-prices";
import { RESERVED_INDEX, SHORT_INDEX } from "../src/synthetic-reservations";

const SYNTHETIC_PREFIX = { nl: "Demo ", fr: "Démo ", de: "Demo ", en: "Demo " } as const;

/** The top-level category a demo category belongs to (itself when it has no parent). */
const topOf = (slug: string): string => {
  const category = CATEGORIES.find((c) => c.slug === slug);
  return category && "parent" in category ? topOf(category.parent) : slug;
};

describe("synthetic catalogue content", () => {
  it("names every product as clearly synthetic, with a unique Dutch name", () => {
    for (const product of PRODUCTS) {
      expect(product.names.nl).toBeDefined();
      for (const [locale, name] of Object.entries(product.names)) {
        const prefix = SYNTHETIC_PREFIX[locale as keyof typeof SYNTHETIC_PREFIX];
        expect(name?.startsWith(prefix), `${locale}: ${name}`).toBe(true);
      }
    }
    const dutch = PRODUCTS.map((p) => p.names.nl);
    expect(new Set(dutch).size).toBe(dutch.length);
  });

  it("holds no prescription product, and every legal status fits its type", () => {
    for (const product of PRODUCTS) {
      expect(product.type).not.toBe("rx_medicine");
      expect(product.legal).not.toBe("rx");
      expect(legalStatusFits(product.type, product.legal)).toBe(true);
    }
  });

  it("puts products only in demo categories", () => {
    const slugs = new Set<string>(CATEGORIES.map((c) => c.slug));
    for (const product of PRODUCTS) {
      expect(product.categories.length).toBeGreaterThan(0);
      for (const slug of product.categories) expect(slugs.has(slug)).toBe(true);
    }
  });

  it("shows at least four active products in every top-level category", () => {
    const tops = CATEGORIES.filter((c) => !("parent" in c)).map((c) => c.slug);
    for (const top of tops) {
      const active = PRODUCTS.filter(
        (p) => p.status === "active" && p.categories.some((slug) => topOf(slug) === top),
      );
      expect(active.length, top).toBeGreaterThanOrEqual(4);
    }
  });

  it("keeps the products the price and reservation demos point at", () => {
    // appending products must never shift these: staging already holds them under these CNKs
    expect(PRODUCTS[SCHEDULED_INDEX]?.names.nl).toBe("Demo Hoestsiroop");
    expect(PRODUCTS[RESERVED_INDEX]?.names.nl).toBe("Demo Neusspray");
    expect(PRODUCTS[SHORT_INDEX]?.names.nl).toBe("Demo Keeltabletten");
  });
});
