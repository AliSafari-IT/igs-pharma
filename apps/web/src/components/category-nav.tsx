import type { ContentLocale } from "@igs/module-catalog";
import type { StorefrontCategoryNode } from "@igs/module-storefront";
import { Link } from "@igs/ui";
import { getTranslations } from "next-intl/server";

/** Indent by depth as fixed classes: the CSP refuses inline styles, and Tailwind needs literals. */
const INDENT: Record<number, string> = { 1: "", 2: "pl-4", 3: "pl-8", 4: "pl-12" };

interface Props {
  readonly locale: ContentLocale;
  readonly tree: readonly StorefrontCategoryNode[];
  readonly activeSlug?: string | undefined;
}

function List({ locale, tree, activeSlug }: Props) {
  return (
    <ul className="flex flex-col">
      {tree.map((category) => (
        <li key={category.id} className={INDENT[category.depth] ?? ""}>
          <Link
            href={`/${locale}/c/${category.slug}`}
            aria-current={category.slug === activeSlug ? "page" : undefined}
            className={`inline-flex min-h-[44px] items-center ${category.slug === activeSlug ? "font-semibold" : ""}`}
          >
            {category.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The category tree as navigation: a side column from `md`, and on a phone a collapsed
 * "Categories" disclosure above the content (a native `<details>`: no script, so the CSP and
 * keyboard behaviour are the browser's own). The two renderings never show together; the hidden
 * one is `display: none`, so a screen reader meets one landmark.
 */
export async function CategoryNav({ locale, tree, activeSlug }: Props) {
  if (tree.length === 0) return <div className="hidden md:block" />;
  const t = await getTranslations({ locale, namespace: "storefront" });
  return (
    <>
      <details className="rounded-[var(--radius-md)] border border-[var(--color-border-strong)] md:hidden">
        <summary className="flex min-h-[44px] cursor-pointer items-center px-4 font-semibold">
          {t("showCategories")}
        </summary>
        <nav aria-label={t("categoriesNav")} className="px-4 pb-3">
          <List locale={locale} tree={tree} activeSlug={activeSlug} />
        </nav>
      </details>
      <nav aria-label={t("categoriesNav")} className="hidden md:block">
        <h2 className="mb-2 font-display text-lg font-semibold">{t("categories")}</h2>
        <List locale={locale} tree={tree} activeSlug={activeSlug} />
      </nav>
    </>
  );
}
