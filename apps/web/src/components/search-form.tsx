import type { ContentLocale } from "@igs/module-catalog";
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH } from "@igs/module-storefront";
import { Button, Input } from "@igs/ui";
import { getTranslations } from "next-intl/server";

interface Props {
  readonly locale: ContentLocale;
  readonly defaultValue?: string | undefined;
}

/**
 * The header search (igs-pharma#104): a plain GET form to `/{locale}/search`, so it works without
 * JavaScript. The label is visually hidden (the placeholder is not a label); the field refuses one
 * character in the browser, and the server says the same in words.
 */
export async function SearchForm({ locale, defaultValue }: Props) {
  const t = await getTranslations({ locale, namespace: "storefront" });
  return (
    // biome-ignore lint/a11y/useSemanticElements: <search> is not in React 19's JSX types yet; a form with role=search is the landmark
    <form
      role="search"
      method="get"
      action={`/${locale}/search`}
      className="flex w-full items-center gap-2 md:max-w-md"
    >
      <label htmlFor="site-search" className="sr-only">
        {t("searchLabel")}
      </label>
      <Input
        id="site-search"
        name="q"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        minLength={MIN_QUERY_LENGTH}
        maxLength={MAX_QUERY_LENGTH}
        defaultValue={defaultValue}
        placeholder={t("searchPlaceholder")}
        className="min-h-[44px] flex-1"
      />
      <Button type="submit" className="min-h-[44px]">
        {t("searchSubmit")}
      </Button>
    </form>
  );
}
