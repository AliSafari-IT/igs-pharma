import type { Tx } from "@igs/kernel";
import { type SQL, and, asc, count, eq, exists, ilike, inArray, like, or } from "drizzle-orm";

import { productContent, products } from "./schema";

/**
 * Product references for OTHER modules' kernel operations (igs-pharma#53: inventory). Plain
 * functions on the caller's transaction, not kernel queries: the calling command or query has
 * already authorized the actor with its own permission, and modules never read each other's tables
 * directly (module-anatomy rule 2). They return identifiers and the Dutch name only.
 */
export interface ProductRef {
  readonly id: string;
  readonly cnk: string;
  /** The Dutch name, `null` while the product has no Dutch content. */
  readonly nameNl: string | null;
}

/** `%`, `_` and `\` are LIKE wildcards: match them literally. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

const refColumns = { id: products.id, cnk: products.cnk, nameNl: productContent.name };

function refsWhere(tx: Tx, where: SQL | undefined) {
  return tx
    .select(refColumns)
    .from(products)
    .leftJoin(
      productContent,
      and(eq(productContent.productId, products.id), eq(productContent.locale, "nl")),
    )
    .where(where);
}

/** The products with these CNKs (unknown CNKs are simply absent). */
export async function productRefsByCnk(
  tx: Tx,
  cnks: readonly string[],
): Promise<readonly ProductRef[]> {
  if (cnks.length === 0) return [];
  return refsWhere(tx, inArray(products.cnk, [...cnks]));
}

/** The products with these ids (unknown ids are simply absent). */
export async function productRefsById(
  tx: Tx,
  ids: readonly string[],
): Promise<readonly ProductRef[]> {
  if (ids.length === 0) return [];
  return refsWhere(tx, inArray(products.id, [...ids]));
}

/**
 * A page of products by CNK order. `q` matches a CNK prefix or a substring of the name in any
 * language (case-insensitive), as in `catalog.product.list`.
 */
export async function searchProductRefs(
  tx: Tx,
  options: { readonly q: string; readonly limit: number; readonly offset: number },
): Promise<{ readonly items: readonly ProductRef[]; readonly total: number }> {
  let where: SQL | undefined;
  if (options.q) {
    const term = escapeLike(options.q);
    const byName = tx
      .select({ one: productContent.productId })
      .from(productContent)
      .where(
        and(eq(productContent.productId, products.id), ilike(productContent.name, `%${term}%`)),
      );
    where = or(like(products.cnk, `${term}%`), exists(byName));
  }
  const [totalRow] = await tx.select({ total: count() }).from(products).where(where);
  const items = await refsWhere(tx, where)
    .orderBy(asc(products.cnk))
    .limit(options.limit)
    .offset(options.offset);
  return { items, total: totalRow?.total ?? 0 };
}
