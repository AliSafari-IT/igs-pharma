import { cn } from "@igs/ui";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/** One semantic table at every width; small screens show labelled rows as cards. */
export function ResponsiveTable({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="overflow-x-auto">
      {/* biome-ignore lint/a11y/noRedundantRoles lint/a11y/useSemanticElements: Preserve semantics when CSS changes display. */}
      <table
        {...props}
        role="table"
        className={cn("responsive-table w-full border-collapse text-left", className)}
      >
        {children}
      </table>
    </div>
  );
}

interface TableCellProps extends ComponentPropsWithoutRef<"td"> {
  readonly label: string;
  readonly children: ReactNode;
}

export function TableCell({ label, children, ...props }: TableCellProps) {
  return (
    // biome-ignore lint/a11y/noRedundantRoles lint/a11y/useSemanticElements: Preserve cell semantics when CSS changes display.
    <td {...props} role="cell">
      <span className="responsive-table-label" aria-hidden="true">
        {label}
      </span>
      <div className="responsive-table-value">{children}</div>
    </td>
  );
}

export function TableHead(props: ComponentPropsWithoutRef<"thead">) {
  // biome-ignore lint/a11y/noRedundantRoles: Preserve table semantics when CSS changes display.
  return <thead {...props} role="rowgroup" />;
}

export function TableBody(props: ComponentPropsWithoutRef<"tbody">) {
  // biome-ignore lint/a11y/noRedundantRoles lint/a11y/useSemanticElements: Preserve table semantics when CSS changes display.
  return <tbody {...props} role="rowgroup" />;
}

export function TableRow(props: ComponentPropsWithoutRef<"tr">) {
  // biome-ignore lint/a11y/noRedundantRoles lint/a11y/useSemanticElements: Preserve table semantics when CSS changes display.
  return <tr {...props} role="row" />;
}

export function TableHeader(props: ComponentPropsWithoutRef<"th">) {
  return <th {...props} scope="col" role="columnheader" />;
}
