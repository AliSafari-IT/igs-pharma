# @igs/module-orders

Carts and orders for the webshop (igs-pharma#116, D-045). Owns the `orders` Postgres schema. This
first slice ships the schema with its database guard and the cart; checkout, payment (Mollie), the
pharmacist review, fulfilment and refunds follow in later slices of #116.

## The cart

- **Server-side, no price, no reservation.** A cart holds product ids and quantities; checkout
  re-prices from pricing and reserves stock through inventory.
- **Whose cart.** A signed-in customer (a `user` holding `orders.create`) always works on their own
  cart, found by user id. Anyone else works on the cart their `__Host-igs-cart` cookie opens: the
  edge mints the value with `newCartToken()` (128 random bits) and passes it as `cartToken`; only its
  SHA-256 is stored.
- **Sign-in.** The edge calls `orders.cart.attach` with the cookie: the guest cart becomes the
  customer's, or is merged into the cart they already have (quantities added up to the limit; lines
  whose product is no longer sellable, or that do not fit, are dropped) and deleted. An attached cart
  loses its token hash, so the cookie left in the browser opens nothing after sign-out.
- **Limits.** At most `CART_MAX_LINES` (30) lines; per product two packs of a medicine and ten of
  anything else (`maxPerOrder`, O-3 defaults until the pharmacist sets per-product limits). Only
  storefront-visible products go in (`catalog.product_not_sellable`, the same answer for a hidden and a
  missing product); a line whose product stops being sellable stays, marked `sellable: false`.
- **Retention.** A cart lives `CART_TTL_DAYS` (30) after its last change; an expired cart is treated
  as absent and deleted when its owner next changes it. The purge job for the others is a follow-up.
- **Public operations.** `orders.cart.get` and `orders.cart.set_line` are `permission: "public"`
  (kernel.md A1): a guest holds no permission. Every change is audited with ids and quantities only,
  as `anonymous` for a guest; the cart token never reaches the audit trail.

## Orders: the database guard (migration `0047_orders`)

The order lifecycle is enforced by Postgres, whoever writes:

- a new order starts in `pending_payment` at version 1; every status change follows
  `ORDER_TRANSITIONS` (`src/domain.ts`); end states (`collected`, `cancelled`, `expired`) never change;
- an order holding a medicine (`needs_review`) reaches `ready_to_prepare` only from `in_review`;
- the reference, customer, locale, totals and creator never change; each update bumps `version` by one;
- at commit, an order has at least one line, its totals are the sums of its lines and `needs_review`
  is true exactly when a line is a medicine; lines are added only while the order is
  `pending_payment` and are never changed;
- every status change is written to `order_events` by a `SECURITY DEFINER` trigger (the runtime roles
  can only read it);
- no DELETE or TRUNCATE of orders, lines or events, for anyone.

`test/guard.test.ts` runs these as the unprivileged runtime role and tries every status pair against
`ORDER_TRANSITIONS`.
