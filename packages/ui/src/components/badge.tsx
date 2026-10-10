import { cva } from "class-variance-authority";
import type React from "react";

import type { ContrastPair } from "../contrast";
import { cn } from "../utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-sans text-xs font-semibold",
  {
    variants: {
      variant: {
        neutral: "bg-[var(--color-surface-2)] text-[var(--color-text-subtle)]",
        primary: "bg-[var(--color-primary-muted)] text-[var(--color-primary-active)]",
        success: "bg-[var(--color-success-subtle)] text-[var(--color-success-text)]",
        error: "bg-[var(--color-error-subtle)] text-[var(--color-error-text)]",
        // Amber is only ever filled, with the dark text colour
        amber: "bg-[var(--color-accent)] text-[var(--color-text)]",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export type BadgeVariant = "neutral" | "primary" | "success" | "error" | "amber";

export const badgeContrast: Record<BadgeVariant, ContrastPair[]> = {
  neutral: [{ fg: "text-subtle", bg: "surface-2", use: "text" }],
  primary: [{ fg: "primary-active", bg: "primary-muted", use: "text" }],
  success: [{ fg: "success-text", bg: "success-subtle", use: "text" }],
  error: [{ fg: "error-text", bg: "error-subtle", use: "text" }],
  amber: [{ fg: "text", bg: "accent", use: "text" }],
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
