import type { ContentLocale } from "@igs/module-catalog";
import { getTranslations } from "next-intl/server";

const STEPS = [
  {
    key: "Order",
    icon: "M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6M9 20h.01M17 20h.01",
  },
  { key: "Check", icon: "M9 12l2 2 4-4M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z" },
  { key: "Pickup", icon: "M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM9 21v-7h6v7" },
] as const;

/**
 * "How it works" on the home (milestone 5.2): order, a pharmacist checks, pick up. It describes what
 * the shop does today (pickup only; delivery comes with 5.3), so the home shows it only while the
 * cart is on: without ordering it would be a promise the shop does not keep.
 */
export async function HowItWorks({ locale }: { readonly locale: ContentLocale }) {
  const t = await getTranslations({ locale, namespace: "storefront" });
  return (
    <section aria-labelledby="home-how" className="mt-10" data-testid="how-it-works">
      <h2 id="home-how" className="mb-3 font-display text-2xl font-semibold">
        {t("howHeading")}
      </h2>
      <ol className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li
            key={step.key}
            className="flex gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={step.icon} />
              </svg>
            </span>
            <div>
              <h3 className="font-semibold">
                <span className="sr-only">{index + 1}. </span>
                {t(`how${step.key}Title`)}
              </h3>
              <p className="mt-1 text-sm text-[var(--color-text-subtle)]">
                {t(`how${step.key}Text`)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
