/**
 * The demo reservations (igs-pharma#99): two seed products get an ORDER set aside, one of them more
 * than the shelf then holds, so the Stock pages can show "Reserved", "Available" and "Short by"
 * on staging and in development. Only orders: they never expire, so the demo stays. (A hold lasts
 * 15 minutes and would be gone before anyone looked.) `seed-catalog.ts` runs it after the stock.
 */
import type { Actor } from "@igs/kernel";
import { listProducts } from "@igs/module-catalog";
import { adjustStock, confirmReservation, getStock, reserveStock } from "@igs/module-inventory";

import { PRODUCTS, SEED_ACTOR, cnkFor, demoStockFor } from "./synthetic-catalog";

/** The checkout's system role, used here to set the demo orders aside. */
export const SEED_RESERVATIONS_ACTOR: Actor = {
  type: "system",
  id: "seed-catalog",
  roles: ["system_reservations"],
};

/** The seed product with a plain order set aside, and how many units. */
export const RESERVED_INDEX = 2;
export const RESERVED_QUANTITY = 4;
/** The seed product whose order takes its whole demo stock, after which five are "found missing". */
export const SHORT_INDEX = 3;
export const SHORT_MISSING = 5;

export interface ReservationSeedResult {
  /** Demo orders set aside by this run. */
  readonly reserved: number;
  /** Products left alone: not the seed's own, or reserved or moved already. */
  readonly skipped: number;
}

/**
 * Sets the demo orders aside. A product is touched only when it is the seed's own, still has just
 * its demo stock movement and has nothing set aside: running it again, or after staff counted,
 * adjusted or reserved anything, changes nothing. (After staff RELEASE the plain demo order and
 * nothing else happened, a new run sets it aside again.)
 */
export async function seedSyntheticReservations(
  actor: Actor = SEED_ACTOR,
  reservationActor: Actor = SEED_RESERVATIONS_ACTOR,
): Promise<ReservationSeedResult> {
  let reserved = 0;
  let skipped = 0;
  for (const index of [RESERVED_INDEX, SHORT_INDEX]) {
    const seed = PRODUCTS[index];
    const cnk = cnkFor(index);
    const [item] = (await listProducts({ cnk, pageSize: 1 }, actor)).items;
    if (!seed || !item || item.cnk !== cnk || item.nameNl !== seed.names.nl) {
      skipped++;
      continue;
    }
    const stock = await getStock({ productId: item.id }, actor);
    if (stock.movements.length !== 1 || stock.reservations.length > 0) {
      skipped++;
      continue;
    }
    const onHand = demoStockFor(index);
    const quantity = index === SHORT_INDEX ? onHand : Math.min(RESERVED_QUANTITY, onHand);
    // a fixed, valid `order:<uuidv7>` per demo product (zeros + the CNK), so a re-run is the same order
    const holderRef = `order:00000000-0000-7000-8000-${cnk.padStart(12, "0")}`;
    await reserveStock({ productId: item.id, quantity, holderRef }, reservationActor);
    await confirmReservation(
      { holderRef, items: [{ productId: item.id, quantity }] },
      reservationActor,
    );
    if (index === SHORT_INDEX) {
      // the shelf holds fewer than the order: a count is not refused, the product shows as short
      await adjustStock(
        {
          productId: item.id,
          // the product's one lot from the stock seed (a medicine always names its lot, #164)
          ...(stock.lots[0] ? { lotId: stock.lots[0].lotId } : {}),
          delta: -SHORT_MISSING,
          reason: "adjustment",
          note: "Demo: five fewer on the shelf than the orders set aside",
        },
        actor,
      );
    }
    reserved++;
  }
  return { reserved, skipped };
}
