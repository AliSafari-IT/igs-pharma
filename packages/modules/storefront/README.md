# @igs/module-storefront

Read model of the webshop (igs-pharma#103): search, listing, product page, category menu and the
back-office "why is this product not visible" query. Contract: `src/contract.ts` (zod).

## Rules

- **Owns no tables and writes nothing.** Every query is a kernel `query()`.
- It never reads another module's tables (module-anatomy rule 2). It composes the public,
  transaction-level helpers of `catalog` (visibility, search, categories), `pricing` (current price)
  and `inventory` (availability status). Those helpers return **storefront-visible data only**; the
  one visibility predicate (D-034, `storefrontVisible()`) includes the approved-content gate for
  medicines. A hidden product and an unknown one answer the same (`catalog.product_not_found`).
- **Only apps import this package** (boundaries element `storefront-module`). No module imports it.
- Availability is `available | low | out`, never a count. The `low` threshold comes from the app
  (`STOREFRONT_LOW_STOCK_THRESHOLD`, default 3) via `configureStorefront`; modules do not read env.
- Products without a current price are not shown in the storefront.

## Ceiling and the trigger to change it

Search, filter, sort and paging run **in memory over the candidate set** (visible and priced
products, narrowed by SQL on text/category first). Measured against the D-041 budget with 2,000
products: list/search p95 < 300 ms (see `test/budget.test.ts`).

- **Ceiling: about 2,000 products.**
- **Trigger to move to a materialised read model** (a table refreshed from catalog/pricing/inventory
  events, with sort/paging in SQL): the catalogue passes ~2,000 visible products, or the budget test
  p95 exceeds 300 ms on CI. Until then, do not add one.

## Test fixtures

`@igs/module-storefront/fixtures` exports in-memory products and `fixtureListProducts` so the front end
can be built before the real queries are wired. Test-only: apps must not import it in production code.
