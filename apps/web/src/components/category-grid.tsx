import type { ContentLocale } from "@igs/module-catalog";
import type { StorefrontCategoryNode } from "@igs/module-storefront";
import { Link } from "@igs/ui";
import { getTranslations } from "next-intl/server";

interface Props {
  readonly locale: ContentLocale;
  readonly categories: readonly StorefrontCategoryNode[];
}

/** The top-level categories as cards (name and how many products), two to a row on a phone. */
export async function CategoryGrid({ locale, categories }: Props) {
  const t = await getTranslations({ locale, namespace: "storefront" });
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {categories.map((category) => (
        <li key={category.id}>
          <Link
            href={`/${locale}/c/${category.slug}`}
            className="flex h-full min-h-[88px] flex-col justify-between gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 no-underline hover:border-[var(--color-primary)]"
          >
            <span className="font-display text-lg font-semibold text-[var(--color-text)]">
              {category.name}
            </span>
            <span className="text-sm text-[var(--color-text-subtle)]">
              {t("productCount", { count: category.productCount })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
