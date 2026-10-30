import { PHARMACY_IDENTITY } from "@igs/config";

import { mobileJson } from "../../../../../server/mobile-api";

/**
 * `GET /api/mobile/v1/pharmacy`: the public identity block of the storefront footer. While
 * `isPlaceholder` is true the app marks every value as a stand-in, as the website does.
 *
 * v1 never changes shape (the app copies the type in `apps/mobile/src/api/types.ts`), so the
 * fields are listed here rather than passing the whole identity: a field added to the identity
 * later (the VAT number, milestone 5.1) stays off v1 until a new version carries it.
 */
export function GET() {
  const {
    isPlaceholder,
    name,
    address,
    phone,
    email,
    pharmacistTitular,
    authorisationNumber,
    openingHours,
  } = PHARMACY_IDENTITY;
  return mobileJson({
    isPlaceholder,
    name,
    address: {
      street: address.street,
      postalCode: address.postalCode,
      city: address.city,
      country: address.country,
    },
    phone,
    email,
    pharmacistTitular,
    authorisationNumber,
    openingHours,
  });
}
