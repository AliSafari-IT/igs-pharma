import { locales } from "@igs/i18n";
import { type StorefrontCategory, listStorefrontCategories } from "@igs/module-catalog";
import { logger } from "@igs/observability/logger";
import { Container, Link } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import type { ContentLocale } from "@igs/module-catalog";
import { PREVIEW_HEADER } from "../preview";
import { ensureKernelConfigured } from "../server/kernel";
import { STOREFRONT_ACTOR } from "../server/storefront";

/** Indent by depth as fixed classes: the CSP refuses inline styles, and Tailwind needs literals. */
const INDENT: Record<number, string> = { 1: "", 2: "pl-4", 3: "pl-8", 4: "pl-12" };

const LANGUAGE_NAMES: Record<string, string> = {
  nl: "Nederlands",
  fr: "Français",
  de: "Deutsch",
  en: "English",
};

interface Props {
  readonly locale: ContentLocale;
  /** The page's path below the locale (`""`, `/c/slug`, `/p/cnk`), for the language links. */
  readonly path: string;
  /** The category being browsed, if any. */
  readonly activeSlug?: string;
  readonly children: ReactNode;
}

/**
 * The shared shell of the storefront pages (igs-pharma#62): the preview banner, the header with the
 * language links, the category tree as navigation, and the main content. The banner shows only on a
 * request the proxy marked as a verified preview.
 */
export async function StorefrontFrame({ locale, path, activeSlug, children }: Props) {
  const t = await getTranslations({ locale, namespace: "storefront" });
  const preview = (await headers()).get(PREVIEW_HEADER) === "1";

  let tree: readonly StorefrontCategory[] = [];
  try {
    await ensureKernelConfigured();
    tree = await listStorefrontCategories({ locale }, STOREFRONT_ACTOR);
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
          lang="en"
          role="note"
          className="bg-[var(--color-accent)] px-4 py-2 text-center text-sm font-semibold text-[var(--color-text)]"
        >
          Preview — not public ·{" "}
          <a href="/preview/end" className="underline underline-offset-2">
            End preview
          </a>
        </div>
      ) : null}
      <header className="border-b border-[var(--color-border)]">
        <Container className="flex flex-wrap items-center justify-between gap-4 py-4">
          <a
            href={`/${locale}`}
            className="font-display text-2xl font-medium text-[var(--color-primary)]"
          >
            IGS-Pharma
          </a>
          <nav aria-label={t("language")}>
            <ul className="flex gap-3">
              {locales.map((code) => (
                <li key={code}>
                  <Link
                    href={`/${code}${path}`}
                    lang={code}
                    hrefLang={code}
                    aria-current={code === locale ? "true" : undefined}
                    className={code === locale ? "font-semibold" : undefined}
                  >
                    {LANGUAGE_NAMES[code]}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </Container>
      </header>
      <div className="flex-1">
        <Container className="grid gap-8 py-8 md:grid-cols-[14rem_1fr]">
          {tree.length > 0 ? (
            <nav aria-label={t("categoriesNav")}>
              <h2 className="mb-2 font-display text-lg font-semibold">{t("categories")}</h2>
              <ul className="flex flex-col gap-1">
                {tree.map((category) => (
                  <li key={category.id} className={INDENT[category.depth] ?? ""}>
                    <Link
                      href={`/${locale}/c/${category.slug}`}
                      aria-current={category.slug === activeSlug ? "page" : undefined}
                      className={category.slug === activeSlug ? "font-semibold" : undefined}
                    >
                      {category.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : (
            <div />
          )}
          <main id="main" className="min-w-0">
            {children}
          </main>
        </Container>
      </div>
    </div>
  );
}
