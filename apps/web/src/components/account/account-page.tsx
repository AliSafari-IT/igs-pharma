import type { ReactNode } from "react";

interface Props {
  readonly title: string;
  readonly intro?: string | undefined;
  readonly children: ReactNode;
}

/** The column every account page shares (igs-pharma#115): heading, a line of intro, then the form. */
export function AccountPage({ title, intro, children }: Props) {
  return (
    <div className="flex max-w-md flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-medium text-[var(--color-primary)]">{title}</h1>
        {intro ? <p className="text-[var(--color-text-subtle)]">{intro}</p> : null}
      </div>
      {children}
    </div>
  );
}
