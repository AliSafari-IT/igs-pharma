/**
 * The synthetic prices (igs-pharma#59): a FAKE web price for every seed product, and one scheduled
 * price change, so the Price panel and the product list's Price column can be tried on staging and
 * in development. `seed-catalog.ts` runs it after the catalogue.
 */
import type { Actor } from "@igs/kernel";
import { listProducts } from "@igs/module-catalog";
import { listPrices, setPrice } from "@igs/module-pricing";

import { PRODUCTS, SEED_ACTOR, cnkFor } from "./synthetic-catalog";

const DAY = 86_400_000;

/** A seed product's demo price in cents, VAT included: from € 3.49 to € 24.49, always ending in 9. */
export const demoPriceFor = (index: number) => 349 + ((index * 300) % 2100);

/** The seed product that gets a scheduled change, and the change itself. */
export const SCHEDULED_INDEX = 0;
export const scheduledPriceFor = (index: number) => demoPriceFor(index) + 50;

export interface PriceSeedResult {
  /** Seed products given their demo price by this run. */
  readonly priced: number;
  /** Scheduled changes added by this run. */
  readonly scheduled: number;
  /** Seed products left alone: priced already (by the seed or by staff), or not the seed's own. */
  readonly skipped: number;
}

/**
 * Gives each seed product without any price its demo price from now, through `pricing.price.set`
 * (audited like an owner's change), and schedules a change for tomorrow on one of them. Running it
 * again, or after staff set a price, changes nothing; a run interrupted between the two steps
 * finishes the scheduled change. A product on a seed CNK that is not the seed's is never touched.
 */
export async function seedSyntheticPrices(
  actor: Actor = SEED_ACTOR,
  now: Date = new Date(),
): Promise<PriceSeedResult> {
  let priced = 0;
  let scheduled = 0;
  let skipped = 0;
  for (const [index, seed] of PRODUCTS.entries()) {
    const cnk = cnkFor(index);
    const [item] = (await listProducts({ cnk, pageSize: 1 }, actor)).items;
    if (!item || item.cnk !== cnk || item.nameNl !== seed.names.nl) {
      skipped++;
      continue;
    }
    const prices = await listPrices({ productId: item.id }, actor);
    const rows = [...prices.history, ...prices.scheduled];
    const onlySeedPrice =
      rows.length === 1 &&
      rows[0]?.createdBy === actor.id &&
      rows[0]?.amountCents === demoPriceFor(index);
    if (rows.length === 0) {
      await setPrice(
        { productId: item.id, amountCents: demoPriceFor(index), reason: "Demo price" },
        actor,
      );
      priced++;
    } else if (!(index === SCHEDULED_INDEX && onlySeedPrice)) {
      skipped++;
      continue;
    }
    if (index === SCHEDULED_INDEX) {
      await setPrice(
        {
          productId: item.id,
          amountCents: scheduledPriceFor(index),
          validFrom: new Date(now.getTime() + DAY).toISOString(),
          reason: "Demo scheduled change",
        },
        actor,
      );
      scheduled++;
    }
  }
  return { priced, scheduled, skipped };
}
