import { PHARMACY_IDENTITY } from "@igs/config";
import type { ContentLocale } from "@igs/module-catalog";
import { Link } from "@igs/ui";
import { getTranslations } from "next-intl/server";

/**
 * "Find your pharmacy" on the storefront home (igs-pharma#112, V2 item 2): where the pharmacy is,
 * when it is open and how to reach it, from the same typed config as the footer
 * (`PHARMACY_IDENTITY`), so the two can never disagree. While the config still holds stand-ins the
 * panel says so, like the footer. The full details (pharmacist-titular, authorisation number) stay
 * in the footer, which the panel links to.
 */
export async function PharmacyPanel({ locale }: { readonly locale: ContentLocale }) {
  const t = await getTranslations({ locale, namespace: "storefront" });
  const identity = PHARMACY_IDENTITY;
  const { address } = identity;

  return (
    <section
      aria-labelledby="home-pharmacy"
      data-testid="pharmacy-panel"
      className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-5"
    >
      <h2 id="home-pharmacy" className="font-display text-2xl font-semibold">
        {t("findPharmacyHeading")}
      </h2>
      <p className="mt-1 text-[var(--color-text-subtle)]">{t("findPharmacyIntro")}</p>
      <p className="mt-3 font-semibold">{identity.name}</p>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-[var(--color-text-subtle)]">{t("address")}</dt>
        <dd>
          {address.street}, {address.postalCode} {address.city}, {address.country}
        </dd>
        <dt className="text-[var(--color-text-subtle)]">{t("openingHours")}</dt>
        <dd>{identity.openingHours}</dd>
        <dt className="text-[var(--color-text-subtle)]">{t("phone")}</dt>
        <dd>{identity.phone}</dd>
      </dl>
      {identity.isPlaceholder ? (
        <p
          role="note"
          data-testid="pharmacy-panel-placeholder"
          className="mt-3 inline-block rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-2 py-1 text-sm font-semibold text-[var(--color-text)]"
        >
          {t("placeholderNote")}
        </p>
      ) : null}
      <p className="mt-3">
        <Link href="#footer-about">{t("pharmacyDetailsLink")}</Link>
      </p>
    </section>
  );
}
