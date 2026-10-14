import type React from "react";

import { cn } from "../utils";

/**
 * A grey block that holds the space of what is loading, so nothing jumps when it arrives. The
 * pulse is off for people who ask for reduced motion. Hidden from screen readers: the page says
 * "loading" once, in words, where it uses this.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "rounded-[var(--radius-md)] bg-[var(--color-surface-2)] motion-safe:animate-pulse",
        className,
      )}
      {...props}
    />
  );
}
