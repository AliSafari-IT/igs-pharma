import {
  EU_COMMON_LOGO_LIST_URL,
  PHARMACY_IDENTITY,
  euCommonLogoAllowed,
  getFeatureFlags,
} from "@igs/config";
import type { ContentLocale } from "@igs/module-catalog";
import { Container, Link } from "@igs/ui";
import { getTranslations } from "next-intl/server";

/**
 * The footer of every storefront page (igs-pharma#104, backlog C11): who runs the pharmacy, from
 * the one typed config (`PHARMACY_IDENTITY`), and the legal pages. While the config still holds
 * stand-ins the footer says so, in plain words, so nobody mistakes them for the real details. The
 * EU common logo shows only when its flag is on, the identity is no longer a stand-in, the owner
 * confirmed the FAMHP registration and `EU_COMMON_LOGO_LIST_URL` is the pharmacy's entry on the
 * FAMHP list (`euCommonLogoAllowed`, igs-pharma#238 items 2.1, 2.2): a logo on a pharmacy that is not
 * registered would claim a registration it does not have. It is text-only here, the approved
 * artwork comes from the owner.
 */
export async function SiteFooter({ locale }: { readonly locale: ContentLocale }) {
  const t = await getTranslations({ locale, namespace: "storefront" });
  const identity = PHARMACY_IDENTITY;
  const euLogo = euCommonLogoAllowed(getFeatureFlags().euCommonLogo);
  const { address } = identity;

  return (
    <footer
      data-testid="site-footer"
      className="border-t border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <Container className="grid gap-8 py-8 md:grid-cols-[2fr_1fr]">
        <section aria-labelledby="footer-about">
          <h2 id="footer-about" className="font-display text-lg font-semibold">
            {t("footerAbout")}
          </h2>
          <p className="mt-1 font-semibold">{identity.name}</p>
          <dl
            data-testid="identity"
            className="mt-2 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm"
          >
            <dt className="text-[var(--color-text-subtle)]">{t("address")}</dt>
            <dd>
              {address.street}, {address.postalCode} {address.city}, {address.country}
            </dd>
            <dt className="text-[var(--color-text-subtle)]">{t("phone")}</dt>
            <dd>{identity.phone}</dd>
            <dt className="text-[var(--color-text-subtle)]">{t("email")}</dt>
            <dd>{identity.email}</dd>
            <dt className="text-[var(--color-text-subtle)]">{t("pharmacistTitular")}</dt>
            <dd>{identity.pharmacistTitular}</dd>
            <dt className="text-[var(--color-text-subtle)]">{t("authorisationNumber")}</dt>
            <dd>{identity.authorisationNumber}</dd>
            <dt className="text-[var(--color-text-subtle)]">{t("legalName")}</dt>
            <dd data-testid="identity-legal-name">{identity.legalName}</dd>
            <dt className="text-[var(--color-text-subtle)]">{t("vatNumber")}</dt>
            <dd data-testid="identity-vat">{identity.vatNumber}</dd>
            <dt className="text-[var(--color-text-subtle)]">{t("openingHours")}</dt>
            <dd>{identity.openingHours}</dd>
          </dl>
          {identity.isPlaceholder ? (
            <p
              role="note"
              data-testid="identity-placeholder"
              className="mt-3 inline-block rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-2 py-1 text-sm font-semibold text-[var(--color-text)]"
            >
              {t("placeholderNote")}
            </p>
          ) : null}
          {euLogo ? (
            <p data-testid="eu-logo" className="mt-4 text-sm">
              <span className="font-semibold">{t("euLogo")}</span>
              {" · "}
              <Link href={EU_COMMON_LOGO_LIST_URL} rel="noopener noreferrer">
                {t("euLogoLink")}
              </Link>
            </p>
          ) : null}
        </section>
        <nav aria-labelledby="footer-legal">
          <h2 id="footer-legal" className="font-display text-lg font-semibold">
            {t("legal")}
          </h2>
          <ul className="mt-2 flex flex-col gap-1">
            {(["terms", "privacy", "cookies"] as const).map((doc) => (
              <li key={doc}>
                <Link href={`/${locale}/legal/${doc}`}>{t(doc)}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
    </footer>
  );
}
