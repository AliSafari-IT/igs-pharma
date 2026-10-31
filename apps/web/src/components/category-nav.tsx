import type { ContentLocale } from "@igs/module-catalog";
import type { StorefrontCategoryNode } from "@igs/module-storefront";
import { Container } from "@igs/ui";
import { getTranslations } from "next-intl/server";

import { categoryBar } from "../lib/category-path";

interface Props {
  readonly locale: ContentLocale;
  readonly tree: readonly StorefrontCategoryNode[];
  readonly activeSlug?: string | undefined;
}

const chip = (current: boolean, inBranch: boolean) =>
  `inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full border px-4 no-underline ${
    current
      ? "border-[var(--color-primary)] bg-[var(--color-primary)] font-semibold text-[var(--color-on-primary)]"
      : inBranch
        ? "border-[var(--color-primary)] bg-[var(--color-primary-subtle)] font-semibold text-[var(--color-primary)]"
        : "border-[var(--color-border-strong)] bg-[var(--color-bg)] text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
  }`;

/**
 * The category bar (igs-pharma#193, milestone 5.2): the top-level categories as one row of chips,
 * and inside a branch a second row with every level under it, so a shopper can go deeper. One
 * `Categories` navigation at every width: on a phone the rows scroll sideways. Links only, no
 * script. The category the page shows carries `aria-current="page"`.
 */
export async function CategoryNav({ locale, tree, activeSlug }: Props) {
  if (tree.length === 0) return null;
  const t = await getTranslations({ locale, namespace: "storefront" });
  const { top, activeTopId, branch } = categoryBar(tree, activeSlug);
  const row = "flex gap-2 overflow-x-auto py-2";
  return (
    <nav
      aria-label={t("categoriesNav")}
      data-testid="category-bar"
      className="border-b border-[var(--color-border)] bg-[var(--color-bg)]"
    >
      <Container>
        <ul className={row}>
          {top.map((category) => (
            <li key={category.id} className="shrink-0">
              <a
                href={`/${locale}/c/${category.slug}`}
                aria-current={category.slug === activeSlug ? "page" : undefined}
                className={chip(category.slug === activeSlug, category.id === activeTopId)}
              >
                {category.name}
              </a>
            </li>
          ))}
        </ul>
        {branch.length > 0 ? (
          <ul
            className={`${row} border-t border-[var(--color-border)]`}
            aria-label={t("subcategoriesNav")}
          >
            {branch.map((category) => (
              <li key={category.id} className="shrink-0">
                <a
                  href={`/${locale}/c/${category.slug}`}
                  aria-current={category.slug === activeSlug ? "page" : undefined}
                  className={chip(category.slug === activeSlug, false)}
                >
                  {category.name}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </Container>
    </nav>
  );
}
