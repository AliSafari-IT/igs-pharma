import type { AvailabilityStatus, ListItem, Locale, Price } from "../api/types";

/**
 * "My list": products saved on the phone, with what they cost and whether they were in stock when
 * saved or last viewed. Never sent anywhere. The website is the truth at order time.
 */
export interface SavedProduct {
  cnk: string;
  name: string;
  brandName: string | null;
  price: Price;
  status: AvailabilityStatus;
  isMedicine: boolean;
  /** The language `name` was saved in. */
  locale: Locale;
  /** When price and stock were last seen (ISO). */
  seenAt: string;
}

export const MAX_SAVED = 100;

export function toSaved(item: ListItem, locale: Locale, now: Date): SavedProduct {
  return {
    cnk: item.cnk,
    name: item.name,
    brandName: item.brandName,
    price: item.price,
    status: item.status,
    isMedicine: item.isMedicine,
    locale,
    seenAt: now.toISOString(),
  };
}

/** Adds a product at the top (or moves it there, refreshed); keeps at most MAX_SAVED. */
export function addSaved(list: readonly SavedProduct[], product: SavedProduct): SavedProduct[] {
  return [product, ...list.filter((entry) => entry.cnk !== product.cnk)].slice(0, MAX_SAVED);
}

export function removeSaved(list: readonly SavedProduct[], cnk: string): SavedProduct[] {
  return list.filter((entry) => entry.cnk !== cnk);
}

/** Refreshes a saved product in place when it is viewed again; unsaved products stay out. */
export function refreshSaved(list: readonly SavedProduct[], product: SavedProduct): SavedProduct[] {
  return list.map((entry) => (entry.cnk === product.cnk ? product : entry));
}

const isSaved = (entry: unknown): entry is SavedProduct => {
  if (typeof entry !== "object" || entry === null) return false;
  const value = entry as Partial<Record<keyof SavedProduct, unknown>>;
  return (
    typeof value.cnk === "string" &&
    /^\d{7}$/.test(value.cnk) &&
    typeof value.name === "string" &&
    typeof (value.price as Partial<Price> | undefined)?.amountCents === "number" &&
    typeof value.seenAt === "string"
  );
};

/** The stored list, dropping anything that does not look like a saved product. */
export function parseSaved(raw: string | null): SavedProduct[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isSaved).slice(0, MAX_SAVED) : [];
  } catch {
    return [];
  }
}
