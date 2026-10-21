import { Stack } from "@igs/ui";
import type { ReactNode } from "react";

import { BrandIcon } from "./brand";

interface Props {
  /** The page's only `<h1>`. */
  readonly title: string;
  readonly children: ReactNode;
}

/**
 * The calm, branded frame of the pages a staff member sees before the back-office shell
 * (igs-pharma#112 V1): sign-in, 2-step setup and the enrolment link. One centred card with the
 * wordmark, the page title and its content. The wordmark is not a heading, so each page keeps a
 * single `<h1>`; the amber dot is decorative (never a text colour).
 */
export function AuthFrame({ title, children }: Props) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] p-8 shadow-sm sm:p-10">
        <Stack gap={6}>
          <div data-testid="auth-wordmark" className="flex flex-col gap-1">
            <span className="flex items-center gap-2 font-display text-2xl font-medium text-[var(--color-primary)]">
              <BrandIcon size={40} />
              <span>IGS-Pharma</span>
            </span>
            <span className="text-sm text-[var(--color-text-subtle)]">Back-office</span>
          </div>
          <h1 className="font-display text-3xl font-medium text-[var(--color-text)]">{title}</h1>
          {children}
        </Stack>
      </div>
    </main>
  );
}
