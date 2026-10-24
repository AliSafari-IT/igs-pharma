import { STOREFRONT_URL } from "../config";
import type { CategoryNode, ListSort, Listing, Locale, Pharmacy, Product } from "./types";

/**
 * Why a request gave no data, as the screens show it:
 * - `closed`: the storefront is not open yet (SITE_GATE), show "opens soon";
 * - `offline`: no answer at all (no network, timeout);
 * - `not_found`: this product or category is not on the storefront;
 * - `invalid`: the app asked something the API refuses (too short a search, …);
 * - `unavailable`: the storefront answered with an error.
 */
export type ApiErrorKind = "closed" | "offline" | "not_found" | "invalid" | "unavailable";

export class ApiError extends Error {
  constructor(readonly kind: ApiErrorKind) {
    super(kind);
    this.name = "ApiError";
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

const TIMEOUT_MS = 15_000;

/** The kind of failure for an HTTP answer that is not 2xx, from its status and `{ error }` code. */
export function errorKind(status: number, code: unknown): ApiErrorKind {
  if (status === 503 && code === "coming_soon") return "closed";
  if (status === 404) return "not_found";
  if (status === 400) return "invalid";
  return "unavailable";
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function getJson<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  fetchImpl: Fetch = fetch,
): Promise<T> {
  const query = Object.entries(params)
    .filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "",
    )
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  const url = `${STOREFRONT_URL}/api/mobile/v1${path}${query ? `?${query}` : ""}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } catch {
    throw new ApiError("offline");
  } finally {
    clearTimeout(timer);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // an HTML page (a proxy, a captive portal, an old storefront without this API)
    throw new ApiError(response.ok ? "unavailable" : errorKind(response.status, undefined));
  }
  if (!response.ok) {
    throw new ApiError(errorKind(response.status, (body as { error?: unknown } | null)?.error));
  }
  return body as T;
}

export interface ListParams {
  locale: Locale;
  q?: string;
  category?: string;
  inStockOnly?: boolean;
  sort?: ListSort;
  page?: number;
}

export const api = {
  products: ({ locale, q, category, inStockOnly, sort, page }: ListParams) =>
    getJson<Listing>("/products", {
      locale,
      q,
      category,
      availability: inStockOnly ? "in_stock" : undefined,
      sort,
      page,
    }),
  product: (cnk: string, locale: Locale) =>
    getJson<Product>(`/products/${encodeURIComponent(cnk)}`, { locale }),
  categories: (locale: Locale) =>
    getJson<{ locale: Locale; categories: CategoryNode[] }>("/categories", { locale }).then(
      (body) => body.categories,
    ),
  pharmacy: () => getJson<Pharmacy>("/pharmacy"),
};
