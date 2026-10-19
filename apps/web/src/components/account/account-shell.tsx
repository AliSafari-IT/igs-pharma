import type { ContentLocale } from "@igs/module-catalog";
import { Link } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { StorefrontFrame } from "../storefront-frame";
import { SignOutButton } from "./sign-out-button";

export type AccountSection = "overview" | "profile" | "security" | "privacy";

const SECTIONS: readonly {
  readonly key: AccountSection;
  readonly path: string;
  readonly label: string;
}[] = [
  { key: "overview", path: "", label: "navOverview" },
  { key: "profile", path: "/profile", label: "navProfile" },
  { key: "security", path: "/security", label: "navSecurity" },
  { key: "privacy", path: "/privacy", label: "navPrivacy" },
];

interface Props {
  readonly locale: ContentLocale;
  readonly section: AccountSection;
  readonly title: string;
  readonly intro?: string | undefined;
  readonly children: ReactNode;
}

/**
 * The frame of every signed-in account page (igs-pharma#115 PR C): the storefront shell, the
 * account menu with the current page marked, a heading and the page. One `h1` per page.
 */
export async function AccountShell({ locale, section, title, intro, children }: Props) {
  const t = await getTranslations({ locale, namespace: "account" });
  const current = SECTIONS.find((item) => item.key === section);
  return (
    <StorefrontFrame locale={locale} path={`/account${current?.path ?? ""}`}>
      <div className="flex flex-col gap-6 md:flex-row md:gap-10">
        <nav aria-label={t("navLabel")} className="md:w-48 md:shrink-0">
          <ul className="flex flex-wrap gap-x-4 md:flex-col">
            {SECTIONS.map((item) => (
              <li key={item.key}>
                <Link
                  href={`/${locale}/account${item.path}`}
                  aria-current={item.key === section ? "page" : undefined}
                  className={`inline-flex min-h-[44px] items-center ${item.key === section ? "font-semibold" : ""}`}
                >
                  {t(item.label)}
                </Link>
              </li>
            ))}
            <li>
              <SignOutButton locale={locale} label={t("signOut")} />
            </li>
          </ul>
        </nav>
        <div className="flex max-w-2xl min-w-0 flex-1 flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-3xl font-medium text-[var(--color-primary)]">
              {title}
            </h1>
            {intro ? <p className="text-[var(--color-text-subtle)]">{intro}</p> : null}
          </div>
          {children}
        </div>
      </div>
    </StorefrontFrame>
  );
}
