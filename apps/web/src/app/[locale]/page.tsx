import { useTranslations } from "next-intl";

export default function HomePage() {
  const t = useTranslations("nav");
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="font-display text-4xl font-medium text-[var(--color-primary)]">
        IGS-Pharma
      </h1>
      <p className="text-[var(--color-text-muted)] text-lg">
        {t("home")} — Phase 0 scaffold
      </p>
    </main>
  );
}
