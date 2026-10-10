import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type React from "react";

import { type ContrastPair, FOCUS_RING, onSurfaces } from "../contrast";
import { cn } from "../utils";

export const linkVariants = cva(
  [
    "underline underline-offset-2 decoration-1 hover:decoration-2",
    "rounded-[var(--radius-sm)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
  ],
  {
    variants: {
      variant: {
        default: "text-[var(--color-primary)] hover:text-[var(--color-primary-hover)]",
        subtle: "text-[var(--color-text-subtle)] hover:text-[var(--color-text)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type LinkVariant = "default" | "subtle";

export const linkContrast: Record<LinkVariant, ContrastPair[]> = {
  default: [
    ...onSurfaces("primary", "text"),
    ...onSurfaces("primary-hover", "text"),
    ...FOCUS_RING,
  ],
  subtle: [...onSurfaces("text-subtle", "text"), ...onSurfaces("text", "text"), ...FOCUS_RING],
};

export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: LinkVariant;
  /** Style the single child instead (e.g. next/link's `<Link>` or next-intl's). */
  asChild?: boolean;
}

/** Links are always underlined: colour alone never marks them (WCAG 1.4.1). */
export function Link({ className, variant, asChild = false, ...props }: LinkProps) {
  const Comp = asChild ? Slot : "a";
  return <Comp className={cn(linkVariants({ variant }), className)} {...props} />;
}
