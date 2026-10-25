import { findStorefrontProductByGtin } from "@igs/module-storefront";
import type { NextRequest } from "next/server";

import { ensureKernelConfigured } from "../../../../../../server/kernel";
import { mobileError, mobileFailure, mobileJson } from "../../../../../../server/mobile-api";
import { STOREFRONT_ACTOR } from "../../../../../../server/storefront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Context {
  readonly params: Promise<{ gtin: string }>;
}

/**
 * `GET /api/mobile/v1/gtin/{gtin}`: the CNK of the product whose pack carries this barcode
 * (`{"cnk":"1234567"}`), for the app's scan (1.1). The app then loads `/products/{cnk}`.
 */
export async function GET(_request: NextRequest, { params }: Context) {
  const { gtin } = await params;
  if (!/^[0-9]{8,14}$/.test(gtin)) return mobileError("not_found", 404);
  try {
    await ensureKernelConfigured();
    return mobileJson(await findStorefrontProductByGtin({ gtin }, STOREFRONT_ACTOR));
  } catch (error) {
    return mobileFailure(error, "mobile.gtin_failed");
  }
}
