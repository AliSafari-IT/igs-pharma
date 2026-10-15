import type { ContentLocale } from "@igs/module-catalog";
import type { ListSort } from "@igs/module-storefront";
import { Button, Label, Link, Select } from "@igs/ui";
import { getTranslations } from "next-intl/server";

interface Props {
  readonly locale: ContentLocale;
  /** The page the form submits to (`/nl/c/zalven`, `/nl/search`). */
  readonly action: string;
  readonly sorts: readonly ListSort[];
  readonly sort: ListSort | undefined;
  readonly inStock: boolean;
  /** The search text to carry along (search page only). */
  readonly q?: string | undefined;
}

const SORT_KEY = {
  relevance: "sortRelevance",
  latest: "sortLatest",
  name: "sortName",
  price_asc: "sortPriceAsc",
  price_desc: "sortPriceDesc",
} as const;

/**
 * Sort and "in stock only" for a listing: a GET form (no JavaScript needed; submitting starts again
 * at page 1) with a way back to the unfiltered list.
 */
export async function ListControls({ locale, action, sorts, sort, inStock, q }: Props) {
  const t = await getTranslations({ locale, namespace: "storefront" });
  const filtered = sort !== undefined || inStock;
  return (
    <form
      method="get"
      action={action}
      aria-label={t("listControls")}
      className="flex flex-wrap items-end gap-x-4 gap-y-2"
    >
      {q ? <input type="hidden" name="q" value={q} /> : null}
      <div className="flex flex-col gap-1">
        <Label htmlFor="list-sort">{t("sortLabel")}</Label>
        <Select id="list-sort" name="sort" defaultValue={sort ?? ""} className="min-h-[44px]">
          <option value="">{t("sortDefault")}</option>
          {sorts.map((value) => (
            <option key={value} value={value}>
              {t(SORT_KEY[value])}
            </option>
          ))}
        </Select>
      </div>
      <label
        htmlFor="list-in-stock"
        className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium"
      >
        <input
          id="list-in-stock"
          type="checkbox"
          name="availability"
          value="in_stock"
          defaultChecked={inStock}
          className="size-5"
        />
        {t("inStockOnly")}
      </label>
      <Button type="submit" variant="secondary" className="min-h-[44px]">
        {t("applyFilters")}
      </Button>
      {filtered ? (
        <Link
          href={q ? `${action}?q=${encodeURIComponent(q)}` : action}
          className="inline-flex min-h-[44px] items-center"
        >
          {t("clearFilters")}
        </Link>
      ) : null}
    </form>
  );
}
