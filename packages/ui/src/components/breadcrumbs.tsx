import type React from "react";

import { cn } from "../utils";
import { Link } from "./link";

export interface BreadcrumbItem {
  readonly label: string;
  /** Left out on the current page, which is not a link. */
  readonly href?: string;
}

export interface BreadcrumbsProps extends React.HTMLAttributes<HTMLElement> {
  readonly items: readonly BreadcrumbItem[];
  /** The landmark's accessible name ("Breadcrumb"), in the page's language. */
  readonly label: string;
}

/** Where the page sits in the tree: an ordered list, the last item marked as the current page. */
export function Breadcrumbs({ items, label, className, ...props }: BreadcrumbsProps) {
  return (
    <nav aria-label={label} className={cn("text-sm", className)} {...props}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${index}-${item.label}`} className="flex items-center gap-2">
              {item.href && !last ? (
                <Link href={item.href} variant="subtle">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className="text-[var(--color-text)]">
                  {item.label}
                </span>
              )}
              {last ? null : (
                <span aria-hidden="true" className="text-[var(--color-text-subtle)]">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
