import "server-only";

import { isDomainError } from "@igs/kernel";
import type { ContentLocale } from "@igs/module-catalog";
import { type StorefrontProductView, getStorefrontProduct } from "@igs/module-storefront";

import { passSecret } from "../early-access";
import { type ListTokenCheck, verifyListToken } from "../list-link";
import { ensureKernelConfigured } from "./kernel";
import { STOREFRONT_ACTOR } from "./storefront";

/** A token from the URL or a form, checked against `AUTH_SECRET` (igs-pharma#218). */
export function checkListToken(value: string | null | undefined): ListTokenCheck {
  return verifyListToken(passSecret(process.env), value, Date.now());
}

/** One product of a list: as the storefront shows it today, or `null` when it is gone from the shop. */
export interface ListEntry {
  readonly cnk: string;
  readonly product: StorefrontProductView | null;
}

/**
 * The products of a checked list, in its order, read from the storefront NOW (the website is the
 * truth, never what the phone saw). A product that is no longer sold comes back as `null`.
 */
export async function loadListEntries(
  cnks: readonly string[],
  locale: ContentLocale,
): Promise<ListEntry[]> {
  await ensureKernelConfigured();
  return Promise.all(
    cnks.map(async (cnk) => {
      try {
        return { cnk, product: await getStorefrontProduct({ cnk, locale }, STOREFRONT_ACTOR) };
      } catch (error) {
        if (isDomainError(error) && error.kind === "NotFound") return { cnk, product: null };
        throw error;
      }
    }),
  );
}
