import { getFeatureFlags } from "@igs/config";
import { locales } from "@igs/i18n";
import type { StorefrontCategoryNode } from "@igs/module-storefront";
import { logger } from "@igs/observability/logger";
import { Container, THEME_COOKIE, ThemeToggle, themeFromCookie } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import type { ContentLocale } from "@igs/module-catalog";
import { EARLY_ACCESS_HEADER, GATE_HEADER } from "../early-access";
import { hasCustomerSessionCookie } from "../lib/account-area";
import { cartItemCount } from "../server/cart";
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

/** A link on the charcoal top bar: light text, a raised hover, a 44 px target. */
const TOP_LINK =
  "min-h-[44px] items-center rounded-[var(--radius-md)] px-2 text-[var(--color-on-topbar)] no-underline hover:bg-[var(--color-topbar-raised)]";

/** A tab of the phone tab bar: icon over label, the whole cell is the target. */
const TAB =
  "flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs font-medium text-[var(--color-text)] no-underline hover:bg-[var(--color-surface-2)]";

function TabIcon({ d }: { readonly d: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/** The language menu: a native `<details>`, no script. */
function LanguageMenu({
  locale,
  path,
  t,
}: {
  readonly locale: string;
  readonly path: string;
  readonly t: Awaited<ReturnType<typeof getTranslations<"storefront">>>;
}) {
  return (
    <details className="relative" data-testid="language-menu">
      <summary
        className={`${TOP_LINK} inline-flex cursor-pointer list-none gap-1 [&::-webkit-details-marker]:hidden`}
      >
        <span aria-hidden="true">{locale.toUpperCase()}</span>
        <span className="sr-only">
          {t("languageMenu", { current: LANGUAGE_NAMES[locale] ?? locale })}
        </span>
      </summary>
      <nav
        aria-label={t("language")}
        className="absolute right-0 z-20 mt-1 min-w-40 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-1 text-[var(--color-text)] shadow-[var(--shadow-pop)] [--color-focus:var(--color-primary)]"
      >
        <ul>
          {locales.map((code) => (
            <li key={code}>
              <a
                href={`/${code}${path}`}
                lang={code}
                hrefLang={code}
                aria-current={code === locale ? "true" : undefined}
                className={`flex min-h-[44px] items-center rounded-[var(--radius-sm)] px-3 text-[var(--color-text)] no-underline hover:bg-[var(--color-surface-2)] ${code === locale ? "font-semibold" : ""}`}
              >
                {LANGUAGE_NAMES[code]}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}

/**
 * The frame of the pages a visitor reaches while the shop is closed (igs-pharma#199: the early-access
 * page and the sign-in pages, marked by the proxy): the logo, the language menu and the theme toggle,
 * and nothing of the shop (no search, categories, cart or footer links).
 */
async function GateFrame({
  locale,
  path,
  children,
}: {
  readonly locale: ContentLocale;
  readonly path: string;
  readonly children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: "storefront" });
  const theme = themeFromCookie((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div data-testid="gate-shell" className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded-[var(--radius-sm)] focus:bg-[var(--color-bg)] focus:px-3 focus:py-2"
      >
        {t("skipToContent")}
      </a>
      <header className="bg-[var(--color-topbar)] text-[var(--color-on-topbar)] [--color-focus:var(--color-topbar-accent)]">
        <Container className="flex items-center gap-3 py-2">
          <a
            href={`/${locale}/early-access`}
            className="inline-flex min-h-[44px] items-center gap-2 font-display text-xl font-medium text-[var(--color-on-topbar)] no-underline md:text-2xl"
          >
            <BrandIcon />
            IGS-Pharma
          </a>
          <div className="ml-auto flex items-center gap-1">
            <LanguageMenu locale={locale} path={path} t={t} />
            <ThemeToggle
              tone="topbar"
              initial={theme}
              labels={{ toDark: t("themeToDark"), toLight: t("themeToLight") }}
            />
          </div>
        </Container>
      </header>
      <div className="flex-1">
        <Container className="py-6 md:py-8">
          <main id="main" className="min-w-0">
            {children}
          </main>
        </Container>
      </div>
    </div>
  );
}

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
 * The shared shell of the storefront pages (igs-pharma#62, restyled in #193 for the OS look): the
 * preview banner, the charcoal top bar (logo, search, Our pharmacy, Account, Cart with its count, the
 * language menu, the theme toggle), the category bar, the page, the footer, and on phones a tab bar
 * (Shop, Search, Cart, Account). The banner shows only on a request the proxy marked as a verified
 * preview. The account links show only while customer accounts are switched on (igs-pharma#115,
 * D-044), the cart links only while the cart is (igs-pharma#116). No script beyond the theme toggle:
 * the language menu is a native `<details>`.
 */
export async function StorefrontFrame({ locale, path, activeSlug, query, children }: Props) {
  const requestHeaders = await headers();
  if (requestHeaders.get(GATE_HEADER) === "closed") {
    return (
      <GateFrame locale={locale} path={path}>
        {children}
      </GateFrame>
    );
  }
  const t = await getTranslations({ locale, namespace: "storefront" });
  const early = requestHeaders.get(EARLY_ACCESS_HEADER) === "1";
  const theme = themeFromCookie((await cookies()).get(THEME_COOKIE)?.value);
  const signedIn = hasCustomerSessionCookie(requestHeaders.get("cookie"));
  const { customerAccounts, cart } = getFeatureFlags();
  const itemCount = cart ? await cartItemCount(locale) : null;
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

  // pb-16: room under the footer for the phone tab bar
  return (
    <div data-testid="shell" className="flex min-h-screen flex-col pb-16 md:pb-0">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded-[var(--radius-sm)] focus:bg-[var(--color-bg)] focus:px-3 focus:py-2"
      >
        {t("skipToContent")}
      </a>
      {early ? (
        <div
          role="note"
          data-testid="early-access-banner"
          className="bg-[var(--color-accent)] px-4 py-2 text-center text-sm font-semibold text-[var(--color-text)]"
        >
          {t("earlyAccessBanner")} ·{" "}
          <a href={`/${locale}/early-access`} className="underline underline-offset-2">
            {t("earlyAccessDetails")}
          </a>
        </div>
      ) : null}
      {/* the charcoal top bar (igs-pharma#193): its focus ring is the light-blue accent */}
      <header className="bg-[var(--color-topbar)] text-[var(--color-on-topbar)] [--color-focus:var(--color-topbar-accent)]">
        <Container className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
          <a
            href={`/${locale}`}
            className="order-1 inline-flex min-h-[44px] items-center gap-2 font-display text-xl font-medium text-[var(--color-on-topbar)] no-underline md:text-2xl"
          >
            <BrandIcon />
            IGS-Pharma
          </a>
          {/* one search form: its own row on a phone, in the bar from md */}
          <div className="order-3 w-full md:order-2 md:w-auto md:flex-1 md:px-4">
            <SearchForm locale={locale} defaultValue={query} />
          </div>
          <div className="order-2 ml-auto flex items-center gap-1 md:order-3">
            {/* the pharmacy behind the shop (#112): the footer's identity block, on every page */}
            <a
              href="#footer-about"
              data-testid="header-pharmacy-link"
              className={`${TOP_LINK} hidden sm:inline-flex`}
            >
              {t("headerPharmacyLink")}
            </a>
            {tAccount ? (
              <a
                href={`/${locale}/account${signedIn ? "" : "/sign-in"}`}
                data-testid="header-account-link"
                className={`${TOP_LINK} hidden md:inline-flex`}
              >
                {tAccount(signedIn ? "headerAccount" : "headerSignIn")}
              </a>
            ) : null}
            {cart ? (
              <a
                href={`/${locale}/cart`}
                data-testid="header-cart-link"
                className={`${TOP_LINK} hidden gap-2 sm:inline-flex`}
              >
                {t("headerCart")}
                {itemCount !== null && itemCount > 0 ? (
                  <span
                    data-testid="header-cart-count"
                    className="inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--color-topbar-accent)] px-1.5 text-sm font-semibold text-[var(--color-topbar)]"
                  >
                    <span aria-hidden="true">{itemCount}</span>
                    <span className="sr-only">{t("cartCount", { count: itemCount })}</span>
                  </span>
                ) : null}
              </a>
            ) : null}
            <LanguageMenu locale={locale} path={path} t={t} />
            <ThemeToggle
              tone="topbar"
              initial={theme}
              labels={{ toDark: t("themeToDark"), toLight: t("themeToLight") }}
            />
          </div>
        </Container>
      </header>
      <CategoryNav locale={locale} tree={tree} activeSlug={activeSlug} />
      <div className="flex-1">
        <Container className="py-6 md:py-8">
          <main id="main" className="min-w-0">
            {children}
          </main>
        </Container>
      </div>
      <SiteFooter locale={locale} />
      {/* phones (igs-pharma#193): the four places a shopper goes most, always in reach */}
      <nav
        aria-label={t("tabBar")}
        data-testid="tab-bar"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-[var(--color-border)] bg-[var(--color-bg)] md:hidden"
      >
        <ul className="grid auto-cols-fr grid-flow-col">
          <li>
            <a href={`/${locale}`} className={TAB}>
              <TabIcon d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
              {t("tabShop")}
            </a>
          </li>
          <li>
            <a href={`/${locale}/search`} className={TAB}>
              <TabIcon d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5" />
              {t("tabSearch")}
            </a>
          </li>
          {cart ? (
            <li>
              <a href={`/${locale}/cart`} className={`${TAB} relative`} data-testid="tab-cart">
                <TabIcon d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6M9 20h.01M17 20h.01" />
                {t("tabCart")}
                {itemCount !== null && itemCount > 0 ? (
                  <span
                    data-testid="tab-cart-count"
                    className="absolute right-[calc(50%-1.5rem)] top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--color-primary)] px-1 text-xs font-semibold text-[var(--color-on-primary)]"
                  >
                    <span aria-hidden="true">{itemCount}</span>
                    <span className="sr-only">{t("cartCount", { count: itemCount })}</span>
                  </span>
                ) : null}
              </a>
            </li>
          ) : null}
          {tAccount ? (
            <li>
              <a href={`/${locale}/account${signedIn ? "" : "/sign-in"}`} className={TAB}>
                <TabIcon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" />
                {tAccount(signedIn ? "headerAccount" : "headerSignIn")}
              </a>
            </li>
          ) : null}
        </ul>
      </nav>
    </div>
  );
}
