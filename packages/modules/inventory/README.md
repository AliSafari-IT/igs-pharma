# @igs/module-inventory

Stock for the pharmacy: an append-only ledger of movements (`inventory.stock_movements`) and the
back-office commands on it. On-hand is the sum of a product's movements; the ledger is the only truth.

## Rules (igs-pharma#83, D-037)

- **`recordMovements` (in `src/ledger.ts`) is the only writer of the ledger.** It takes the stock lock,
  inserts the movements ordered by product (so concurrent multi-row writers take locks in the same
  order) and turns the database's refusal into the typed `inventory.negative_stock`. A test
  (`test/single-writer.test.ts`) fails when any other source file writes the table; its allow-list is
  that one file.
- **The database is the backstop.** A trigger on `stock_movements` keeps `inventory.stock_levels`
  (one row per product and location) and its `on_hand >= 0` check refuses any movement that would go
  below zero, whoever inserts it and whether or not they hold the application lock. The trigger
  function is `SECURITY DEFINER`, owned by the migrator role, with a pinned `search_path` and no
  EXECUTE for anyone; the runtime roles can only read `stock_levels`. The ledger remains the truth
  (reads still sum it); `stock_levels` is derived and a test keeps the two equal.
- **A CSV import is two steps.** `inventory.stock.import_prepare` validates the file and stores a
  plan (`inventory.import_plans`: product id, on-hand at preview, count in the file; no free text)
  valid for one hour, and returns its id. `inventory.stock.import` takes only that id and applies it,
  or refuses the WHOLE import with `inventory.import_stale` (a count of changed rows) when the
  on-hand of any product in it differs from the preview. A plan belongs to the actor who prepared it.
  The plan id is the idempotency key of the confirm: a double click replays; the same file previewed
  again is a new plan and applies again.

## Follow-up

Expired plans are not deleted yet. The runtime roles have no DELETE; a narrow `SECURITY DEFINER`
purge function called by a worker job (like the privacy purge) is a separate task.
