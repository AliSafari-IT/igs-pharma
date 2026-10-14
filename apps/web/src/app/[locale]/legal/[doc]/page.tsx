import { Link } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { StorefrontFrame } from "../../../../components/storefront-frame";
import { localeOf } from "../../../../server/storefront";

const DOCS = ["terms", "privacy", "cookies"] as const;
type Doc = (typeof DOCS)[number];
const isDoc = (value: string): value is Doc => (DOCS as readonly string[]).includes(value);

interface Props {
  readonly params: Promise<{ locale: string; doc: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { locale: rawLocale, doc } = await params;
  const locale = localeOf(rawLocale);
  if (!locale || !isDoc(doc)) return {};
  const t = await getTranslations({ locale, namespace: "storefront" });
  return { title: `${t(doc)} · IGS-Pharma` };
}

/**
 * Terms, privacy and cookies (igs-pharma#104): placeholder pages in the shopper's language. The
 * real text is supplied by counsel later; until then the page says so rather than inventing any.
 */
export default async function LegalPage({ params }: Props) {
  const { locale: rawLocale, doc } = await params;
  const locale = localeOf(rawLocale);
  if (!locale || !isDoc(doc)) notFound();
  const t = await getTranslations({ locale, namespace: "storefront" });
  return (
    <StorefrontFrame locale={locale} path={`/legal/${doc}`}>
      <h1 className="font-display text-3xl font-medium text-[var(--color-primary)]">{t(doc)}</h1>
      <p className="mt-4 max-w-prose" data-testid="legal-pending">
        {t("legalPending")}
      </p>
      <p className="mt-6">
        <Link href={`/${locale}`} className="inline-flex min-h-[44px] items-center">
          {t("legalBack")}
        </Link>
      </p>
    </StorefrontFrame>
  );
}
