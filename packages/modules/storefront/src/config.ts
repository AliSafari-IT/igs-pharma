/**
 * Runtime settings of the storefront read model (igs-pharma#103). Modules do not read the
 * environment: the app's composition root parses `STOREFRONT_LOW_STOCK_THRESHOLD` and passes it here
 * once at boot. Never configured (tests, tools): the default.
 */
export const DEFAULT_LOW_STOCK_THRESHOLD = 3;
export const MAX_LOW_STOCK_THRESHOLD = 50;

let lowStockThreshold = DEFAULT_LOW_STOCK_THRESHOLD;

export interface StorefrontSettings {
  /** On hand at or below this (and above 0) shows as `low`. 0–50. */
  readonly lowStockThreshold?: number;
}

export function configureStorefront(settings: StorefrontSettings = {}): void {
  const value = settings.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
  if (!Number.isInteger(value) || value < 0 || value > MAX_LOW_STOCK_THRESHOLD) {
    throw new Error(
      `storefront: lowStockThreshold must be a whole number from 0 to ${MAX_LOW_STOCK_THRESHOLD}`,
    );
  }
  lowStockThreshold = value;
}

export const currentLowStockThreshold = (): number => lowStockThreshold;
