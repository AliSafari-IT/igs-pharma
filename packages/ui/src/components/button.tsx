import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type React from "react";

import { type ContrastPair, FOCUS_RING, onSurfaces } from "../contrast";
import { cn } from "../utils";

export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2",
    "rounded-[var(--radius-md)] font-sans font-semibold leading-none",
    "transition-colors duration-150",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
    "disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)]",
        secondary:
          "bg-transparent border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary-subtle)]",
        ghost: "bg-transparent text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
        // Amber only ever carries the dark text colour; no prop can change it
        accent: "bg-[var(--color-accent)] text-[var(--color-text)] hover:brightness-95",
        danger: "bg-[var(--color-error)] text-white hover:bg-[var(--color-error-text)]",
      },
      size: {
        sm: "min-h-[36px] min-w-[36px] px-3 py-2 text-xs",
        md: "min-h-[44px] min-w-[44px] px-4 py-2.5 text-sm",
        lg: "min-h-[52px] min-w-[52px] px-6 py-3 text-base",
      },
      iconOnly: { true: "px-0", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", iconOnly: false },
  },
);

export type ButtonVariant = "primary" | "secondary" | "ghost" | "accent" | "danger";

/** The token pairs each variant draws (checked by contrast.test.ts). */
export const buttonContrast: Record<ButtonVariant, ContrastPair[]> = {
  primary: [
    { fg: "white", bg: "primary", use: "text" },
    { fg: "white", bg: "primary-hover", use: "text" },
    { fg: "white", bg: "primary-active", use: "text" },
    ...FOCUS_RING,
  ],
  secondary: [
    ...onSurfaces("primary", "text"),
    ...onSurfaces("primary", "ui"),
    { fg: "primary", bg: "primary-subtle", use: "text" },
    ...FOCUS_RING,
  ],
  ghost: [
    ...onSurfaces("text", "text"),
    { fg: "text", bg: "surface-2", use: "text" },
    ...FOCUS_RING,
  ],
  accent: [{ fg: "text", bg: "accent", use: "text" }, ...FOCUS_RING],
  danger: [
    { fg: "white", bg: "error", use: "text" },
    { fg: "white", bg: "error-text", use: "text" },
    ...FOCUS_RING,
  ],
};

type BaseButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  /** Render the single child (e.g. a link) with the button styles instead of a <button>. */
  asChild?: boolean;
  /** Shows a spinner, sets aria-busy and disables the button. Ignored with `asChild`. */
  loading?: boolean;
};

/** An icon-only button has no visible text, so it must carry an accessible name. */
export type ButtonProps = BaseButtonProps &
  ({ iconOnly?: false; "aria-label"?: string } | { iconOnly: true; "aria-label": string });

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      data-slot="spinner"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  iconOnly = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, iconOnly }), className);
  if (asChild) {
    return (
      <Slot className={classes} {...props}>
        {children}
      </Slot>
    );
  }
  return (
    <button
      type="button"
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
