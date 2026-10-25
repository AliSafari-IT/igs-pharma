import { listStorefrontProducts } from "@igs/module-storefront";
import type { NextRequest } from "next/server";

import { ensureKernelConfigured } from "../../../../../server/kernel";
import {
  mobileError,
  mobileFailure,
  mobileJson,
  mobileLocale,
} from "../../../../../server/mobile-api";
import { STOREFRONT_ACTOR } from "../../../../../server/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/mobile/v1/products?locale&q&category&availability&sort&page`: one page of the listing,
 * with the same validation and limits as the storefront's own pages (the query's zod contract).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const locale = mobileLocale(params);
  if (!locale) return mobileError("invalid_input", 400);
  const optional = (name: string, key: string = name) => {
    const value = params.get(name);
    return value === null ? {} : { [key]: value };
  };
  try {
    await ensureKernelConfigured();
    const listing = await listStorefrontProducts(
      {
        locale,
        ...optional("q"),
        ...optional("category", "categorySlug"),
        ...optional("availability"),
        ...optional("sort"),
        ...optional("page"),
      } as Parameters<typeof listStorefrontProducts>[0],
      STOREFRONT_ACTOR,
    );
    return mobileJson(listing);
  } catch (error) {
    return mobileFailure(error, "mobile.products_failed");
  }
}
