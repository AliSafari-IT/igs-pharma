import { useLocale, useTranslations } from "next-intl";

export default function NotFoundPage() {
  const t = useTranslations("notFound");
  const locale = useLocale();
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="font-display text-4xl font-medium text-[var(--color-primary)]">
        {t("title")}
      </h1>
      <a className="text-[var(--color-text-muted)] text-lg underline" href={`/${locale}`}>
        {t("backHome")}
      </a>
    </main>
  );
}
