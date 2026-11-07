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

## SAM import (igs-pharma#237)

The weekly import of OTC medicines from SAM, the official Belgian medicines database (FAMHP and
RIZIV-INAMI). It is the only writer of `source = 'sam'` texts.

**Where the code lives**

- `src/sam/`, exported from the module's entry point (`src/index.ts`).
  - `parse.ts`: a streaming `saxes` reader that yields one `<Amp>` tree at a time.
  - `map.ts`: a pure function that maps an AMPP to an import row or to a skip reason.
  - `import.ts`: the commands and `runSamImport`.
  - `jobs.ts`: the pg-boss queue, the schedule and the handler.
- The download, the temp file and the unzip are in `apps/worker/src/sam-export.ts`, outside any
  command (D-019).

**Mapping.** One AMPP (one pack) becomes one product row, matched by its public-pharmacy CNK
(`Dmpp codeType="CNK" deliveryEnvironment="P"`). Each `Data from/to` period counts only on the days
it covers (Brussels date). The checks run in the order below; the first one that fails decides
what happens to the pack:

| Check | When it fails |
|---|---|
| a public-pharmacy CNK exists | `skipped.no_public_cnk` |
| `isValidCnk` | `skipped.invalid_cnk` |
| an `Ampp/Data` period is in force today | `skipped.no_current_data` |
| `DeliveryModus@code` is present | `skipped.no_delivery_modus` |
| the code is in `SAM_OTC_DELIVERY_MODUS_CODES` | `skipped.prescription` (**fail closed**: an empty list imports nothing) |
| NL and FR names exist (`Ampp/Data/PrescriptionNameFamhp`, else `Amp/Data/Name`; DE optional) | `skipped.missing_name` |
| `Status = AUTHORIZED` and a `Commercialization` period covers today | counted as `withdrawn`; nothing is written or deleted |
| the GTIN passes `normalizeGtin` | the pack is imported without a GTIN, counted `gtin.invalid` |

**Writing.** Batches of up to 500 rows go through `catalog.sam_import.batch` (permission
`catalog.products.import`, held only by the system role `system_catalog_import`). The command is
internal: no user actor can call it.

- **A new CNK** becomes a `draft` product: `otc_medicine` / `otc` / `BE_6`,
  `requires_pharmacist_review = true`. It gets `sam` texts with `approved_by` empty. The import
  never activates a product.
- **An existing product**:
  - Its status and its regulated fields are never written.
  - If its type, legal status or VAT class differ from the values above, it counts as a
    `conflict`, and nothing about it is written.
  - A `manual` or `medipim` text is never touched (`textsKept`).
  - A `sam` text whose name changed is updated, and its approval is cleared.
  - A missing locale is added.
  - A GTIN is filled only when the product has none and no other product uses it (otherwise
    `gtin.taken`). A different stored GTIN stays (`gtin.kept`).
  - The `version` goes up by one only when something changed. So importing the same file twice
    writes nothing (`unchanged`).
- **A failed batch** is retried row by row. Rows that still fail are counted as `failed`.

**One audit event per run:** `catalog.sam_import.completed`, recorded by
`catalog.sam_import.record_run`. It holds counts only, no CNK and no text. Its `outcome` is
`aborted` when the file breaks half-way; the error is rethrown after the event is written. The
log line also lists how many packs carried each delivery-modus code.

**Running it**

- **Weekly job:** Mondays at 05:41 Europe/Brussels, queue `catalog.sam_import.run`, with a
  dead-letter alarm `catalog.sam_import.failed`. Without `SAM_EXPORT_URL` the job is not
  scheduled, and the worker logs a warning at boot.
- **Manual run:** `node dist/sam-import.js [--file export.zip] [--dry-run]` (in dev:
  `pnpm --filter @igs/worker sam-import …`).
  - `--dry-run` writes nothing.
  - Use it first to confirm the OTC delivery-modus codes against a real export.
