import { Button, Input, Label, Link } from "@igs/ui";

interface Props {
  /** The list page's path, e.g. `/products`. */
  readonly action: string;
  readonly id: string;
  readonly label: string;
  /** The current search (`""` = none). */
  readonly q: string;
}

/**
 * The search box of a back-office list (igs-pharma#104): a plain GET form (works without script),
 * and a "Clear search" link back to the full list while a search is applied.
 */
export function ListSearch({ action, id, label, q }: Props) {
  return (
    <search>
      <form method="get" action={action} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-64 flex-1 flex-col gap-1.5">
          <Label htmlFor={id}>{label}</Label>
          <Input id={id} name="q" type="search" defaultValue={q} maxLength={100} />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {q ? (
          <Link
            href={action}
            className="inline-flex min-h-[44px] items-center"
            data-testid="clear-search"
          >
            Clear search
          </Link>
        ) : null}
      </form>
    </search>
  );
}
