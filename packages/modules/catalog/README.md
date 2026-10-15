# @igs/module-catalog

Products, brands, categories and their texts (Postgres schema `catalog`).

## Storefront visibility (D-034)

Phase 1 sells OTC only; prescription medicines must never be listed, shown or priced at a distance.
A product is **storefront-visible** only if `status = 'active'` AND `legal_status <> 'rx'` AND
`product_type <> 'rx_medicine'` (`pharmacy_only`, `otc` and `general_sale` stay visible).

- `storefrontVisible()` (`src/visibility.ts`) is the one SQL predicate. Every storefront-actor read
  applies it: the storefront helpers in `src/listing.ts` that `@igs/module-storefront` composes
  (the only storefront read path), and the refs used by `pricing.price.*` and
  `inventory.availability.get` (`productRefsForActor`: staff holding `catalog.products.read` see
  every product, anyone else only visible ones).
- A hidden product behaves exactly like one that does not exist (same `*_not_found` code, same
  empty result).
- **`assertSellable(tx, productId)`**: the first cart or checkout command must call this before a
  product enters a basket or order. It throws `catalog.product_not_sellable` (a not-found error)
  for a hidden or unknown product, so the two cannot be told apart. Use `storefrontVisibleIds`
  to check several ids at once.

## Editing rules (igs-pharma#80)

- **Version.** `catalog.products` and `catalog.categories` have a `version` (starts at 1; every write
  to the row adds one, including the siblings a reorder rewrites and a status change). `getProduct`
  and `listCategories` return it; `updateProduct`, `updateCategory` and `moveCategory` take it as
  `expectedVersion` and refuse a stale one with `catalog.stale_version` (details: `expected`,
  `current`) **before anything is written**. Product content is saved as a whole set, so this is
  what keeps a stale form from deleting another editor's translation. `setProductStatus` takes no
  version (a deliberate single-field transition) but bumps it.
- **Moving up or down** sends `direction: "up" | "down"`, resolved against the siblings as they are
  at that moment under the tree lock; the absolute `parentId` + `position` form (re-parenting) also
  takes `expectedVersion`.
- **The CNK is a business key.** It cannot change on an `active` product (`catalog.cnk_locked`).
  On a draft or archived product a change is audited as `catalog.product.cnk_changed`
  (`fromCnk`, `toCnk`). To correct a live product's CNK: archive it, correct the CNK, activate it
  again (the id, stock and price history stay). A lost race for a CNK is `catalog.cnk_taken`, never
  the unique index's raw error.
- **Regulated fields and approval (igs-pharma#79, D-034).** Two command families, one static
  permission each. The content commands (`createProduct`, `updateProduct`, `setProductStatus`;
  `catalog.products.manage`) create only the general envelope, accept regulated values only when
  they equal the stored ones (`catalog.regulated_fields_require_pharmacist`) and never activate a
  medicine (`catalog.medicine_activation_requires_pharmacist`). The `*Regulated` commands
  (`catalog.products.regulated.manage`, pharmacists only) change them, and check type against
  legal status (`catalog.product_type_legal_status_mismatch`). `approved_by` on product content
  means "a pharmacist read this text": it is stamped only by an editor's save on a general product
  or a pharmacist's save with `approveContent: true` (default `false`). Any other save keeps the
  approval of a locale whose text is unchanged and leaves a changed or new locale unapproved.
