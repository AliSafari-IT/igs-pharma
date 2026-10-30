// The Android app's read-only API (asafarim-docs ventures/igs-pharma/09-mobile): the storefront
// queries as JSON, the same actor, and stable error codes with no message, stack or input.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listStorefrontProducts = vi.fn();
const getStorefrontProduct = vi.fn();
const listStorefrontCategories = vi.fn();
const findStorefrontProductByGtin = vi.fn();
const logger = { error: vi.fn() };
vi.mock("@igs/module-storefront", () => ({
  listStorefrontProducts,
  getStorefrontProduct,
  listStorefrontCategories,
  findStorefrontProductByGtin,
}));
vi.mock("@igs/observability/logger", () => ({ logger }));
// the real @igs/kernel pulls in server-only code; its error type is all these routes use
const { DomainError } = vi.hoisted(() => {
  class DomainError extends Error {
    constructor(
      readonly kind: string,
      readonly code: string,
      readonly options: { fields?: unknown } = {},
    ) {
      super(code);
    }
  }
  return { DomainError };
});
vi.mock("@igs/kernel", () => ({
  DomainError,
  isDomainError: (error: unknown) => error instanceof DomainError,
}));
vi.mock("../src/server/kernel", () => ({ ensureKernelConfigured: vi.fn(async () => {}) }));

const BASE = "http://localhost:3000/api/mobile/v1";
const req = (path: string) => new NextRequest(`${BASE}${path}`);
const LISTING = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 24,
  pageCount: 0,
  category: null,
  q: "ibuprofen",
};

beforeEach(() => {
  for (const fn of [
    listStorefrontProducts,
    getStorefrontProduct,
    listStorefrontCategories,
    findStorefrontProductByGtin,
  ]) {
    fn.mockReset();
  }
  logger.error.mockReset();
});

describe("GET /api/mobile/v1/products", () => {
  it("passes the app's parameters to the storefront query with the read-only actor", async () => {
    listStorefrontProducts.mockResolvedValue(LISTING);
    const { GET } = await import("../src/app/api/mobile/v1/products/route");
    const res = await GET(
      req("/products?locale=fr&q=ibuprofen&category=pijn&availability=in_stock&sort=name&page=2"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(LISTING);
    expect(res.headers.get("cache-control")).toContain("public");
    expect(listStorefrontProducts).toHaveBeenCalledWith(
      {
        locale: "fr",
        q: "ibuprofen",
        categorySlug: "pijn",
        availability: "in_stock",
        sort: "name",
        page: "2",
      },
      expect.objectContaining({ id: "storefront", roles: ["system_storefront"] }),
    );
  });

  it("defaults to Dutch and refuses a language the storefront does not have", async () => {
    listStorefrontProducts.mockResolvedValue(LISTING);
    const { GET } = await import("../src/app/api/mobile/v1/products/route");
    await GET(req("/products"));
    expect(listStorefrontProducts).toHaveBeenCalledWith({ locale: "nl" }, expect.anything());
    const bad = await GET(req("/products?locale=es"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_input" });
  });

  it("maps a validation error to 400 and an unknown category to 404, without logging", async () => {
    const { GET } = await import("../src/app/api/mobile/v1/products/route");
    listStorefrontProducts.mockRejectedValueOnce(
      new DomainError("ValidationFailed", "kernel.validation_failed", {
        fields: [{ path: "q", code: "too_short" }],
      }),
    );
    const short = await GET(req("/products?q=a"));
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: "invalid_input" });
    listStorefrontProducts.mockRejectedValueOnce(
      new DomainError("NotFound", "catalog.category_not_found"),
    );
    const gone = await GET(req("/products?category=gone"));
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: "not_found" });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("answers 503 'unavailable' for anything else and logs it without the query text", async () => {
    listStorefrontProducts.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:5432"));
    const { GET } = await import("../src/app/api/mobile/v1/products/route");
    const res = await GET(req("/products?q=secret-search"));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "unavailable" });
    expect(text).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret-search");
  });
});

describe("GET /api/mobile/v1/products/{cnk}", () => {
  const ctx = (cnk: string) => ({ params: Promise.resolve({ cnk }) });

  it("returns the product in the requested language", async () => {
    getStorefrontProduct.mockResolvedValue({ cnk: "1234567", name: "x" });
    const { GET } = await import("../src/app/api/mobile/v1/products/[cnk]/route");
    const res = await GET(req("/products/1234567?locale=de"), ctx("1234567"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cnk: "1234567", name: "x" });
    expect(getStorefrontProduct).toHaveBeenCalledWith(
      { cnk: "1234567", locale: "de" },
      expect.objectContaining({ roles: ["system_storefront"] }),
    );
  });

  it("answers 404 for a malformed CNK without asking the database, and for a hidden product", async () => {
    const { GET } = await import("../src/app/api/mobile/v1/products/[cnk]/route");
    expect((await GET(req("/products/12ab"), ctx("12ab"))).status).toBe(404);
    expect(getStorefrontProduct).not.toHaveBeenCalled();
    getStorefrontProduct.mockRejectedValue(
      new DomainError("NotFound", "catalog.product_not_found"),
    );
    const res = await GET(req("/products/7654321"), ctx("7654321"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("GET /api/mobile/v1/gtin/{gtin}", () => {
  const ctx = (gtin: string) => ({ params: Promise.resolve({ gtin }) });

  it("returns the CNK of the scanned pack", async () => {
    findStorefrontProductByGtin.mockResolvedValue({ cnk: "1234567" });
    const { GET } = await import("../src/app/api/mobile/v1/gtin/[gtin]/route");
    const res = await GET(req("/gtin/5410013111006"), ctx("5410013111006"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cnk: "1234567" });
    expect(findStorefrontProductByGtin).toHaveBeenCalledWith(
      { gtin: "5410013111006" },
      expect.objectContaining({ roles: ["system_storefront"] }),
    );
  });

  it("answers 404 for a code that is not a GTIN without asking the database, and for an unknown one", async () => {
    const { GET } = await import("../src/app/api/mobile/v1/gtin/[gtin]/route");
    expect((await GET(req("/gtin/12ab"), ctx("12ab"))).status).toBe(404);
    expect((await GET(req("/gtin/1234567"), ctx("1234567"))).status).toBe(404);
    expect(findStorefrontProductByGtin).not.toHaveBeenCalled();
    findStorefrontProductByGtin.mockRejectedValue(
      new DomainError("NotFound", "catalog.product_not_found"),
    );
    const res = await GET(req("/gtin/5410013111006"), ctx("5410013111006"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("GET /api/mobile/v1/categories", () => {
  it("returns the visible tree with its language", async () => {
    listStorefrontCategories.mockResolvedValue([{ slug: "pijn" }]);
    const { GET } = await import("../src/app/api/mobile/v1/categories/route");
    const res = await GET(req("/categories?locale=en"));
    expect(await res.json()).toEqual({ locale: "en", categories: [{ slug: "pijn" }] });
    expect(listStorefrontCategories).toHaveBeenCalledWith({ locale: "en" }, expect.anything());
  });
});

describe("GET /api/mobile/v1/pharmacy", () => {
  it("returns the public identity block, placeholder flag included", async () => {
    const { GET } = await import("../src/app/api/mobile/v1/pharmacy/route");
    const body = await GET().json();
    expect(body).toMatchObject({ name: "IGS-Pharma", isPlaceholder: expect.any(Boolean) });
    expect(body.address).toHaveProperty("city");
  });

  it("keeps v1's exact fields: nothing added to the identity reaches it (the VAT number, milestone 5.1)", async () => {
    const { GET } = await import("../src/app/api/mobile/v1/pharmacy/route");
    const body = await GET().json();
    expect(Object.keys(body).sort()).toEqual(
      [
        "address",
        "authorisationNumber",
        "email",
        "isPlaceholder",
        "name",
        "openingHours",
        "pharmacistTitular",
        "phone",
      ].sort(),
    );
    expect(Object.keys(body.address).sort()).toEqual(["city", "country", "postalCode", "street"]);
  });
});
