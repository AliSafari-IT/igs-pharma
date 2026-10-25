import { listStorefrontCategories } from "@igs/module-storefront";
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

/** `GET /api/mobile/v1/categories?locale=nl`: the visible category tree, flat, in tree order. */
export async function GET(request: NextRequest) {
  const locale = mobileLocale(request.nextUrl.searchParams);
  if (!locale) return mobileError("invalid_input", 400);
  try {
    await ensureKernelConfigured();
    const categories = await listStorefrontCategories({ locale }, STOREFRONT_ACTOR);
    return mobileJson({ locale, categories });
  } catch (error) {
    return mobileFailure(error, "mobile.categories_failed");
  }
}
