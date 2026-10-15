import { Link } from "@igs/ui";
import type { ReactNode } from "react";

interface Props {
  /** The page's only `<h1>`. */
  readonly title: string;
  /** One or two plain sentences under the title: what the page is for. */
  readonly description?: ReactNode;
  /** The page's primary action (a button or link), shown at the end of the title row. */
  readonly action?: ReactNode;
  /** A link to the page above this one, shown above the title. */
  readonly back?: { readonly href: string; readonly label: string };
}

/**
 * The header every back-office page shares (igs-pharma#112 V1): an optional back link, the single
 * `<h1>` with the page's primary action on the same row, and an optional description. One layout
 * instead of a hand-rolled one per page.
 */
export function PageHeader({ title, description, action, back }: Props) {
  return (
    <header className="flex flex-col gap-3">
      {back ? (
        <Link href={back.href} className="text-sm">
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl font-medium text-[var(--color-primary)]">{title}</h1>
        {action ? <div className="flex flex-wrap items-center gap-3">{action}</div> : null}
      </div>
      {description ? (
        <p className="max-w-prose text-[var(--color-text-subtle)]">{description}</p>
      ) : null}
    </header>
  );
}
