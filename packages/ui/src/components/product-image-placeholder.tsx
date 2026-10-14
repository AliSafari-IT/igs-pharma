import type React from "react";

import { cn } from "../utils";

/**
 * The picture slot of a product until real images exist: a fixed 4:3 box with a neutral outline
 * of a bottle. Decorative (`aria-hidden`); the product's name carries the meaning. The fixed
 * aspect ratio keeps the layout still once real images arrive.
 */
export function ProductImagePlaceholder({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex aspect-[4/3] w-full items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-2)] text-[var(--color-text-subtle)]",
        className,
      )}
      {...props}
    >
      <svg
        viewBox="0 0 48 48"
        className="h-1/2 w-auto"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <title>Product image placeholder</title>
        <path d="M18 6h12M20 6v6l-5 7v21a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V19l-5-7V6" />
        <path d="M15 26h18" />
      </svg>
    </div>
  );
}
