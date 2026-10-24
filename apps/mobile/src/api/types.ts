/**
 * The JSON of `/api/mobile/v1/*` (apps/web/src/app/api/mobile/v1). A copy of the storefront
 * contract (`@igs/module-storefront` contract.ts): `v1` never changes shape, so a copy is safe and
 * keeps React Native out of the web workspace.
 */
export type Locale = "nl" | "fr" | "de" | "en";
export type AvailabilityStatus = "available" | "low" | "out";
export type ListSort = "relevance" | "latest" | "name" | "price_asc" | "price_desc";

export interface Price {
  /** Euro cents including VAT. */
  amountCents: number;
  vatClass: string;
  /** Basis points: 600 = 6 %. */
  vatRateBp: number;
}

export interface CategoryRef {
  slug: string;
  name: string;
}

export interface ListItem {
  id: string;
  cnk: string;
  name: string;
  brandName: string | null;
  shortDescription: string | null;
  /** The language the texts are in: the shopper's, or Dutch when not translated yet. */
  contentLocale: Locale;
  price: Price;
  status: AvailabilityStatus;
  isMedicine: boolean;
  topCategory: CategoryRef | null;
}

export interface Listing {
  items: ListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  category: CategoryRef | null;
  q: string | null;
}

export interface Product extends ListItem {
  description: string | null;
  warnings: string | null;
  breadcrumb: CategoryRef[];
  categories: CategoryRef[];
}

export interface CategoryNode {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  depth: number;
  productCount: number;
}

export interface Pharmacy {
  isPlaceholder: boolean;
  name: string;
  address: { street: string; postalCode: string; city: string; country: string };
  phone: string;
  email: string;
  pharmacistTitular: string;
  authorisationNumber: string;
  openingHours: string;
}
