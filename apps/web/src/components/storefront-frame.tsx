import { getFeatureFlags } from "@igs/config";
import { locales } from "@igs/i18n";
import type { StorefrontCategoryNode } from "@igs/module-storefront";
import { logger } from "@igs/observability/logger";
import { Container, Link } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import type { ContentLocale } from "@igs/module-catalog";
import { hasCustomerSessionCookie } from "../lib/account-area";
import { PREVIEW_HEADER } from "../preview";
import { categoryTree } from "../server/storefront";
import { BrandIcon } from "./brand";
import { CategoryNav } from "./category-nav";
import { SearchForm } from "./search-form";
import { SiteFooter } from "./site-footer";

const LANGUAGE_NAMES: Record<string, string> = {
  nl: "Nederlands",
  fr: "Français",
  de: "Deutsch",
  en: "English",
};

interface Props {
  readonly locale: ContentLocale;
  /** The page's path below the locale, with its query (`""`, `/c/slug?page=2`), for the language links. */
  readonly path: string;
  /** The search text to keep in the header field (search page only). */
  readonly query?: string | undefined;
  /** The category being browsed, if any. */
  readonly activeSlug?: string | undefined;
  readonly children: ReactNode;
}

/**
 * The shared shell of the storefront pages (igs-pharma#62): the preview banner, the header with the
 * language links, the category tree as navigation, and the main content. The banner shows only on a
 * request the proxy marked as a verified preview. The account link shows only while customer accounts
 * are switched on (igs-pharma#115, D-044), the cart link only while the cart is (igs-pharma#116).
 */
export async function StorefrontFrame({ locale, path, activeSlug, query, children }: Props) {
  const t = await getTranslations({ locale, namespace: "storefront" });
  const requestHeaders = await headers();
  const preview = requestHeaders.get(PREVIEW_HEADER) === "1";
  const signedIn = hasCustomerSessionCookie(requestHeaders.get("cookie"));
  const { customerAccounts, cart } = getFeatureFlags();
  const tAccount = customerAccounts
    ? await getTranslations({ locale, namespace: "account" })
    : null;

  let tree: readonly StorefrontCategoryNode[] = [];
  try {
    tree = await categoryTree(locale);
  } catch (error) {
    // the shell still renders: the page itself shows the "unavailable" notice if it cannot read either
    logger.error(
      { event: "storefront.categories_failed", err: error },
      "storefront.categories_failed",
    );
  }

  return (
    <div data-testid="shell" className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded-[var(--radius-sm)] focus:bg-[var(--color-bg)] focus:px-3 focus:py-2"
      >
        {t("skipToContent")}
      </a>
      {preview ? (
        <div
          role="note"
          data-testid="preview-banner"
          className="bg-[var(--color-accent)] px-4 py-2 text-center text-sm font-semibold text-[var(--color-text)]"
        >
          {t("previewBanner")} ·{" "}
          <a href="/preview/end" className="underline underline-offset-2">
            {t("previewEnd")}
          </a>
        </div>
      ) : null}
      <header className="border-b border-[var(--color-border)]">
        <Container className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
          <a
            href={`/${locale}`}
            className="inline-flex min-h-[44px] items-center gap-2 font-display text-2xl font-medium text-[var(--color-primary)]"
          >
            <BrandIcon />
            IGS-Pharma
          </a>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            {/* the pharmacy behind the shop (#112): the footer's identity block, on every page */}
            <Link
              href="#footer-about"
              data-testid="header-pharmacy-link"
              className="inline-flex min-h-[44px] items-center"
            >
              {t("headerPharmacyLink")}
            </Link>
            {tAccount ? (
              <Link
                href={`/${locale}/account${signedIn ? "" : "/sign-in"}`}
                data-testid="header-account-link"
                className="inline-flex min-h-[44px] items-center"
              >
                {tAccount(signedIn ? "headerAccount" : "headerSignIn")}
              </Link>
            ) : null}
            {cart ? (
              <Link
                href={`/${locale}/cart`}
                data-testid="header-cart-link"
                className="inline-flex min-h-[44px] items-center"
              >
                {t("headerCart")}
              </Link>
            ) : null}
            <nav aria-label={t("language")}>
              <ul className="flex flex-wrap gap-x-3">
                {locales.map((code) => (
                  <li key={code}>
                    <Link
                      href={`/${code}${path}`}
                      lang={code}
                      hrefLang={code}
                      aria-current={code === locale ? "true" : undefined}
                      className={`inline-flex min-h-[44px] items-center ${code === locale ? "font-semibold" : ""}`}
                    >
                      {LANGUAGE_NAMES[code]}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </Container>
        <Container className="pb-3">
          <SearchForm locale={locale} defaultValue={query} />
        </Container>
      </header>
      <div className="flex-1">
        <Container className="grid gap-6 py-6 md:grid-cols-[14rem_1fr] md:gap-8 md:py-8">
          <CategoryNav locale={locale} tree={tree} activeSlug={activeSlug} />
          <main id="main" className="min-w-0">
            {children}
          </main>
        </Container>
      </div>
      <SiteFooter locale={locale} />
    </div>
  );
}
