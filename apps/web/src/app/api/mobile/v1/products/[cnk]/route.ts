import { getStorefrontProduct } from "@igs/module-storefront";
import type { NextRequest } from "next/server";

import { ensureKernelConfigured } from "../../../../../../server/kernel";
import {
  mobileError,
  mobileFailure,
  mobileJson,
  mobileLocale,
} from "../../../../../../server/mobile-api";
import { STOREFRONT_ACTOR } from "../../../../../../server/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Context {
  readonly params: Promise<{ cnk: string }>;
}

/** `GET /api/mobile/v1/products/{cnk}?locale=nl`: one product as its storefront page shows it. */
export async function GET(request: NextRequest, { params }: Context) {
  const { cnk } = await params;
  const locale = mobileLocale(request.nextUrl.searchParams);
  if (!locale) return mobileError("invalid_input", 400);
  if (!/^[0-9]{7}$/.test(cnk)) return mobileError("not_found", 404);
  try {
    await ensureKernelConfigured();
    return mobileJson(await getStorefrontProduct({ cnk, locale }, STOREFRONT_ACTOR));
  } catch (error) {
    return mobileFailure(error, "mobile.product_failed");
  }
}
