import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";

import { cn } from "../utils.js";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2",
    "min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-[var(--radius-md)]",
    "font-sans text-sm font-semibold leading-none",
    "transition-colors duration-150",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)]",
        secondary:
          "bg-transparent border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary-subtle)]",
        ghost: "bg-transparent text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
        danger: "bg-[var(--color-error)] text-white hover:bg-[var(--color-error-text)]",
      },
      size: {
        sm: "min-h-[36px] min-w-[36px] px-3 py-2 text-xs",
        md: "min-h-[44px] min-w-[44px] px-4 py-2.5 text-sm",
        lg: "min-h-[52px] min-w-[52px] px-6 py-3 text-base",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
