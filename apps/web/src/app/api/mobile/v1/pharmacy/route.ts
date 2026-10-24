import { PHARMACY_IDENTITY } from "@igs/config";

import { mobileJson } from "../../../../../server/mobile-api";

/**
 * `GET /api/mobile/v1/pharmacy`: the public identity block of the storefront footer. While
 * `isPlaceholder` is true the app marks every value as a stand-in, as the website does.
 */
export function GET() {
  return mobileJson(PHARMACY_IDENTITY);
}
