import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type React from "react";

import { cn } from "../utils";

const containerVariants = cva("mx-auto w-full px-4 sm:px-6", {
  variants: {
    size: { sm: "max-w-2xl", md: "max-w-4xl", lg: "max-w-6xl" },
  },
  defaultVariants: { size: "lg" },
});

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
  /** Render the single child (e.g. <main>) with the container styles. */
  asChild?: boolean;
}

/** Centred page column. Layout only: no colour. */
export function Container({ className, size, asChild = false, ...props }: ContainerProps) {
  const Comp = asChild ? Slot : "div";
  return <Comp className={cn(containerVariants({ size }), className)} {...props} />;
}

const stackVariants = cva("flex", {
  variants: {
    direction: { column: "flex-col", row: "flex-row flex-wrap" },
    gap: { 1: "gap-1", 2: "gap-2", 3: "gap-3", 4: "gap-4", 6: "gap-6", 8: "gap-8" },
    align: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
    },
  },
  defaultVariants: { direction: "column", gap: 4, align: "stretch" },
});

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  direction?: "column" | "row";
  gap?: 1 | 2 | 3 | 4 | 6 | 8;
  align?: "start" | "center" | "end" | "stretch";
  asChild?: boolean;
}

/** Flex column (or wrapping row) with a gap from the spacing scale. Layout only: no colour. */
export function Stack({ className, direction, gap, align, asChild = false, ...props }: StackProps) {
  const Comp = asChild ? Slot : "div";
  return <Comp className={cn(stackVariants({ direction, gap, align }), className)} {...props} />;
}
