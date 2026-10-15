import { Alert, Link } from "@igs/ui";
import type { ReactNode } from "react";

import type { TileResult } from "../lib/dashboard";

interface Props<T> {
  readonly id: string;
  readonly title: string;
  readonly result: TileResult<T>;
  readonly href: string;
  readonly linkLabel: string;
  /** The tile's body for loaded data. */
  readonly children: (data: T) => ReactNode;
}

/** One dashboard tile: a titled card with its numbers, or its own error state, and a link in. */
export function DashboardTile<T>({ id, title, result, href, linkLabel, children }: Props<T>) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={`tile-${id}`}
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4"
    >
      <h2 id={`${id}-title`} className="font-display text-lg font-semibold">
        {title}
      </h2>
      {result.state === "error" ? (
        <Alert variant="error" title="This could not be loaded">
          The rest of the dashboard is fine. Reload the page to try again.
        </Alert>
      ) : (
        children(result.data)
      )}
      <Link href={href} className="mt-auto inline-flex min-h-[44px] items-center">
        {linkLabel}
      </Link>
    </section>
  );
}

/** A number with its label, for the `<dl>` inside a tile. */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly hint?: string;
  /** `attention` marks a number someone should act on (never colour alone: the label says it too). */
  readonly tone?: "attention";
}) {
  return (
    <div>
      <dt className="text-sm text-[var(--color-text-subtle)]">{label}</dt>
      <dd
        className={`font-display text-3xl font-semibold ${
          tone === "attention" && value > 0 ? "text-[var(--color-error-text)]" : ""
        }`}
      >
        {value}
      </dd>
      {hint ? <p className="text-xs text-[var(--color-text-subtle)]">{hint}</p> : null}
    </div>
  );
}
