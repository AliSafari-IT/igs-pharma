import { Link } from "@igs/ui";

import { countLine, listHref, pageCount } from "../lib/list-query";

interface Props {
  readonly path: string;
  readonly q: string;
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  /** Singular; the count line adds the "s". */
  readonly noun: string;
}

/** Previous / count line / next under a back-office list (igs-pharma#104). */
export function ListPager({ path, q, page, pageSize, total, noun }: Props) {
  const pages = pageCount(total, pageSize);
  return (
    <nav aria-label="Pages" className="flex items-center gap-4">
      {page > 1 ? <Link href={listHref(path, q, page - 1)}>Previous page</Link> : null}
      <span className="text-sm text-[var(--color-text-subtle)]">
        {countLine(page, pages, total, noun)}
      </span>
      {page < pages ? <Link href={listHref(path, q, page + 1)}>Next page</Link> : null}
    </nav>
  );
}
