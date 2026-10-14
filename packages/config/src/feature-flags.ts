/**
 * Phase 0 stub — flags are read from environment.
 * Phase 1: replace with DB-backed OpenFeature provider.
 */
export interface FeatureFlags {
  prescriptionReservations: boolean;
  /** The EU common logo in the storefront footer; off until the pharmacy is registered. */
  euCommonLogo: boolean;
}

export function getFeatureFlags(): FeatureFlags {
  return {
    prescriptionReservations:
      process.env["NEXT_PUBLIC_FEATURE_PRESCRIPTION_RESERVATIONS"] === "true",
    euCommonLogo: process.env["NEXT_PUBLIC_FEATURE_EU_COMMON_LOGO"] === "true",
  };
}
