import type { ReactNode } from "react";

import type { NavGroup } from "../lib/nav";
import { NavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";

interface Props {
  /** The signed-in staff member's name. */
  readonly name: string;
  /** Their staff roles, already named (`staffRoleSummary`); nothing is shown when empty. */
  readonly roleSummary: string;
  readonly groups: readonly NavGroup[];
  readonly children: ReactNode;
}

/**
 * The back-office frame for a signed-in staff member (igs-pharma#115): a header with who they are
 * and a sign-out button, a sidebar of the pages they may open, and the page itself. Pages keep
 * their own `<main>`; the shell adds the banner and the navigation around it. From 1024 px the
 * sidebar is a column (below that the wide tables of the pages need the full width); under it the sidebar is a native "Menu" disclosure (no script, so the CSP and the
 * keyboard behaviour are the browser's own).
 */
export function BackOfficeShell({ name, roleSummary, groups, children }: Props) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded-[var(--radius-sm)] focus:bg-[var(--color-bg)] focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
          <a
            href="/"
            className="inline-flex min-h-[44px] items-center font-display text-xl font-medium text-[var(--color-primary)]"
          >
            IGS-Pharma Platform
          </a>
          <div className="flex items-center gap-3">
            <span className="flex flex-col items-end leading-tight">
              <span data-testid="staff-name" className="font-semibold">
                {name}
              </span>
              {roleSummary ? (
                <span data-testid="staff-role" className="text-sm text-[var(--color-text-subtle)]">
                  {roleSummary}
                </span>
              ) : null}
            </span>
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
