# @igs/module-catalog

Products, brands, categories and their texts (Postgres schema `catalog`).

## Storefront visibility (D-034)

Phase 1 sells OTC only; prescription medicines must never be listed, shown or priced at a distance.
A product is **storefront-visible** only if `status = 'active'` AND `legal_status <> 'rx'` AND
`product_type <> 'rx_medicine'` (`pharmacy_only`, `otc` and `general_sale` stay visible).

- `storefrontVisible()` (`src/visibility.ts`) is the one SQL predicate. Every storefront-actor read
  applies it: `catalog.storefront.*` queries, and the refs used by `pricing.price.*` and
  `inventory.availability.get` (`productRefsForActor`: staff holding `catalog.products.read` see
  every product, anyone else only visible ones).
- A hidden product behaves exactly like one that does not exist (same `*_not_found` code, same
  empty result).
- **`assertSellable(tx, productId)`**: the first cart or checkout command must call this before a
  product enters a basket or order. It throws `catalog.product_not_sellable` (a not-found error)
  for a hidden or unknown product, so the two cannot be told apart. Use `storefrontVisibleIds`
  to check several ids at once.
