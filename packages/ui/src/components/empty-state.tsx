import type React from "react";

import { cn } from "../utils";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly title: string;
  readonly children?: React.ReactNode;
}

/** "Nothing here": a short title, an optional line of help and an optional action. */
export function EmptyState({ title, children, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] p-6",
        className,
      )}
      {...props}
    >
      <p className="font-display text-lg font-semibold">{title}</p>
      {children ? <div className="text-[var(--color-text-subtle)]">{children}</div> : null}
    </div>
  );
}
