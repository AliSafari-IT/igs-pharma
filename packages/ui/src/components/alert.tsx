import { cva } from "class-variance-authority";
import type React from "react";

import type { ContrastPair } from "../contrast";
import { cn } from "../utils";

export const alertVariants = cva(
  "flex gap-3 rounded-[var(--radius-md)] border p-4 font-sans text-sm text-[var(--color-text)]",
  {
    variants: {
      variant: {
        success: "bg-[var(--color-success-subtle)] border-[var(--color-success)]",
        error: "bg-[var(--color-error-subtle)] border-[var(--color-error)]",
        info: "bg-[var(--color-primary-subtle)] border-[var(--color-primary-muted)]",
      },
    },
    defaultVariants: { variant: "info" },
  },
);

/** Title (and icon) colour per variant; the body text is always --color-text. */
export const alertTitleClasses = {
  success: "text-[var(--color-success-text)]",
  error: "text-[var(--color-error-text)]",
  info: "text-[var(--color-primary-active)]",
} as const;

export type AlertVariant = "success" | "error" | "info";

export const alertContrast: Record<AlertVariant, ContrastPair[]> = {
  success: [
    { fg: "success-text", bg: "success-subtle", use: "text" },
    { fg: "text", bg: "success-subtle", use: "text" },
  ],
  error: [
    { fg: "error-text", bg: "error-subtle", use: "text" },
    { fg: "text", bg: "error-subtle", use: "text" },
  ],
  info: [
    { fg: "primary-active", bg: "primary-subtle", use: "text" },
    { fg: "text", bg: "primary-subtle", use: "text" },
  ],
};

const ICONS: Record<AlertVariant, string> = {
  // check in a circle
  success:
    "M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.86-9.72a.75.75 0 0 0-1.22-.88l-3.24 4.5-1.6-1.6a.75.75 0 1 0-1.06 1.06l2.22 2.22a.75.75 0 0 0 1.14-.09l3.76-5.21Z",
  // exclamation in a circle
  error:
    "M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm-.75-11.25a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4ZM10 14.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  // "i" in a circle
  info: "M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-10.25a.75.75 0 0 0-1.5 0v5a.75.75 0 0 0 1.5 0v-5ZM10 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
};

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  variant?: AlertVariant;
  /** Required: the meaning is always spelled out in text, never carried by colour alone. */
  title: React.ReactNode;
}

/** Errors are announced (role="alert"); success and info are polite (role="status"). */
export function Alert({ className, variant = "info", title, children, ...props }: AlertProps) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="currentColor"
        className={cn("mt-0.5 size-5 shrink-0", alertTitleClasses[variant])}
        data-slot="icon"
      >
        <path fillRule="evenodd" d={ICONS[variant]} />
      </svg>
      <div className="flex flex-col gap-1">
        <p className={cn("font-semibold", alertTitleClasses[variant])}>{title}</p>
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}
