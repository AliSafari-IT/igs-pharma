import { locales } from "@igs/i18n";
import { getTranslations } from "next-intl/server";

import { BrandLogo } from "../../components/brand";

/** Static "coming soon" page, in Dutch, French, German and English (igs-pharma#46). */
export default async function ComingSoonPage() {
  const blocks = await Promise.all(
    locales.map(async (locale) => ({
      locale,
      t: await getTranslations({ locale, namespace: "comingSoon" }),
    })),
  );

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] p-8 shadow-sm sm:p-12">
        <h1 className="flex justify-center">
          <BrandLogo width={220} alt="IGS-Pharma · Pharmacie Laaroussi" />
        </h1>
        <div className="mt-8 divide-y divide-[var(--color-border)]">
          {blocks.map(({ locale, t }) => (
            <section key={locale} lang={locale} className="py-5 first:pt-0 last:pb-0">
              <h2 className="font-display text-xl text-[var(--color-text)]">{t("title")}</h2>
              <p className="mt-1 text-[var(--color-text-subtle)]">{t("body")}</p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
