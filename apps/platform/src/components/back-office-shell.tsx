import { type ThemeChoice, ThemeToggle } from "@igs/ui";
import type { ReactNode } from "react";

import type { NavGroup } from "../lib/nav";
import { BrandIcon } from "./brand";
import { NavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";

interface Props {
  /** The signed-in staff member's name. */
  readonly name: string;
  /** Their staff roles, already named (`staffRoleSummary`); nothing is shown when empty. */
  readonly roleSummary: string;
  readonly groups: readonly NavGroup[];
  /** The staff member's light/dark choice from the cookie, for the toggle (igs-pharma#191). */
  readonly theme?: ThemeChoice | undefined;
  /** `DEPLOY_STAGE=staging` (igs-pharma#197): the top bar says so; never on production. */
  readonly staging?: boolean;
  readonly children: ReactNode;
}

/**
 * The back-office frame for a signed-in staff member (igs-pharma#115; the OS look, #197): a charcoal
 * top bar with the brand, a "Staging" badge on staging, who they are, the theme toggle and sign-out, a sidebar of the pages they may open, and the page itself. Pages keep
 * their own `<main>`; the shell adds the banner and the navigation around it. From 1024 px the
 * sidebar is a column (below that the wide tables of the pages need the full width); under it the sidebar is a native "Menu" disclosure (no script, so the CSP and the
 * keyboard behaviour are the browser's own).
 */
export function BackOfficeShell({
  name,
  roleSummary,
  groups,
  theme,
  staging = false,
  children,
}: Props) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded-[var(--radius-sm)] focus:bg-[var(--color-bg)] focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      {/* the charcoal top bar of the OS look (igs-pharma#197), as on the storefront: its own focus ring */}
      <header className="bg-[var(--color-topbar)] text-[var(--color-on-topbar)] [--color-focus:var(--color-topbar-accent)]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="inline-flex min-h-[44px] items-center gap-2 font-display text-xl font-medium text-[var(--color-on-topbar)] no-underline"
            >
              <BrandIcon size={32} />
              IGS-Pharma Platform
            </a>
            {staging ? (
              <span
                data-testid="staging-badge"
                className="rounded-full bg-[var(--color-topbar-accent)] px-2.5 py-0.5 text-sm font-semibold text-[var(--color-topbar)]"
              >
                Staging
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <span className="flex flex-col items-end leading-tight">
              <span data-testid="staff-name" className="font-semibold">
                {name}
              </span>
              {roleSummary ? (
                <span
                  data-testid="staff-role"
                  className="text-sm text-[var(--color-on-topbar-muted)]"
                >
                  {roleSummary}
                </span>
              ) : null}
            </span>
            <ThemeToggle
              tone="topbar"
              initial={theme}
              labels={{ toDark: "Switch to the dark theme", toLight: "Switch to the light theme" }}
            />
            <SignOutButton />
          </div>
        </div>
      </header>
      <div className="flex flex-1 flex-col lg:flex-row">
        <aside className="border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4 lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
          <details className="lg:hidden">
            <summary className="flex min-h-[44px] cursor-pointer items-center font-semibold">
              Menu
            </summary>
            <NavLinks groups={groups} label="Back-office" />
          </details>
          <div className="hidden lg:block">
            <NavLinks groups={groups} label="Back-office" />
          </div>
        </aside>
        <div id="main" className="min-w-0 flex-1 overflow-x-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
