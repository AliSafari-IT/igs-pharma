# @igs/module-pricing

Prices (append-only, per channel, with `validFrom`), VAT classes and the price maths. Money is whole
euro cents in an integer; a VAT rate is in basis points.

## The reference price of a reduction (igs-pharma#83, D6)

Omnibus (art. 6a Directive 98/6/EC as amended): the reference of a "was / now" display is the lowest
price applied in the 30 days **before** the reduction was applied. `lowestPriceBefore(points,
appliedAt)` and `priceReductionAt(points, at)` (and the query `pricing.price.reference_30d`) compute it:

- the window is `[appliedAt − 30 calendar days, appliedAt)`: closed at the start, **open at the end**,
  so the price that starts at `appliedAt` (the reduction itself) and anything later never counts; the
  price in force when the window opens does;
- 30 days are Europe/Brussels calendar days (`@igs/time`), not 30 × 24 h: across a daylight-saving
  change the window opens an hour earlier or later in UTC;
- `priceReductionAt` is `null` unless the price in force at `at` is lower than its reference; for a
  reduction after a reduction the reference is the lowest price of the 30 days before the latest one;
- **a product priced for less than 30 days** gets the lowest price actually applied in the history
  that exists and `fullWindow: false`. No price is invented for the missing days.

**Open point for the owner (compliance, not maths):** whether a was/now display is allowed when
`fullWindow` is `false`. Nothing displays the reference price yet; decide before the first display.
