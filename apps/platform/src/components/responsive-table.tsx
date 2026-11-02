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
      <SemanticTable
        {...props}
        className={cn("responsive-table w-full border-collapse text-left", className)}
      >
        {children}
      </SemanticTable>
    </div>
  );
}

function SemanticTable(props: ComponentPropsWithoutRef<"table">) {
  // biome-ignore lint/a11y/noRedundantRoles lint/a11y/useSemanticElements: Preserve semantics when CSS changes display.
  return <table {...props} role="table" />;
}

interface TableCellProps extends ComponentPropsWithoutRef<"td"> {
  readonly label: string;
  readonly stacked?: boolean;
  readonly children: ReactNode;
}

export function TableCell({
  label,
  children,
  stacked = false,
  className,
  ...props
}: TableCellProps) {
  return (
    <SemanticCell {...props} className={cn(className, stacked && "responsive-table-stacked")}>
      <span className="responsive-table-label" aria-hidden="true">
        {label}
      </span>
      <div className="responsive-table-value">{children}</div>
    </SemanticCell>
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

function SemanticCell(props: ComponentPropsWithoutRef<"td">) {
  // biome-ignore lint/a11y/noRedundantRoles lint/a11y/useSemanticElements: Preserve cell semantics when CSS changes display.
  return <td {...props} role="cell" />;
}

export function TableFoot(props: ComponentPropsWithoutRef<"tfoot">) {
  // biome-ignore lint/a11y/noRedundantRoles lint/a11y/useSemanticElements: Preserve table semantics when CSS changes display.
  return <tfoot {...props} role="rowgroup" />;
}

export function TableRowHeader(props: ComponentPropsWithoutRef<"th">) {
  // biome-ignore lint/a11y/noRedundantRoles: Preserve row-header semantics when CSS changes display.
  return <th {...props} scope="row" role="rowheader" />;
}

export function TableFooterCell(props: ComponentPropsWithoutRef<"td">) {
  return <SemanticCell {...props} />;
}
