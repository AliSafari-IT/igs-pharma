import { newId } from "@igs/db/ids";
import { command, notFound, validationFailed } from "@igs/kernel";
import { productRefsById } from "@igs/module-catalog";
import { PERMISSIONS } from "@igs/rbac";
import { z } from "zod";

import { PRICING_AUDIT } from "./audit";
import { isValidAmount } from "./domain";
import { prices } from "./schema";

/**
 * Pricing commands (igs-pharma#59). They run through the kernel: authorize → validate → one
 * transaction (handler + audit), behind `pricing.price.manage`. A price is only ever INSERTed; the
 * current price is derived (see `queries.ts`).
 */

/**
 * Sets a product's web price (in cents, VAT included) from now, or schedules it from a later
 * `validFrom`. Errors: `pricing.amount_invalid` (not a whole number of cents in
 * 1…`MAX_AMOUNT_CENTS`), `pricing.valid_from_in_past`, `pricing.unknown_product`.
 */
export const setPrice = command({
  name: "pricing.price.set",
  input: z.object({
    productId: z.uuid(),
    amountCents: z.number(),
    /** Omitted: from now. */
    validFrom: z.coerce.date().optional(),
    reason: z.string().trim().max(200).optional(),
  }),
  output: z.object({ priceId: z.uuid(), validFrom: z.iso.datetime(), scheduled: z.boolean() }),
  permission: PERMISSIONS.pricing.priceManage,
  async handler({ input, ctx }) {
    if (!isValidAmount(input.amountCents)) {
      throw validationFailed("pricing.amount_invalid", [
        { path: "amountCents", code: "pricing.amount_invalid" },
      ]);
    }
    const validFrom = input.validFrom ?? ctx.now;
    if (validFrom.getTime() < ctx.now.getTime()) {
      throw validationFailed("pricing.valid_from_in_past", [
        { path: "validFrom", code: "pricing.valid_from_in_past" },
      ]);
    }
    const [product] = await productRefsById(ctx.tx, [input.productId]);
    if (!product) throw notFound("pricing.unknown_product");

    const priceId = newId();
    const scheduled = validFrom.getTime() > ctx.now.getTime();
    await ctx.tx.insert(prices).values({
      id: priceId,
      productId: product.id,
      channel: "web",
      amountCents: input.amountCents,
      validFrom,
      reason: input.reason ? input.reason : null,
      createdByType: ctx.actor.type,
      createdBy: ctx.actor.id,
      createdAt: ctx.now,
    });
    await ctx.audit.record({
      action: PRICING_AUDIT.priceSet,
      entityType: "product",
      entityId: product.id,
      data: {
        priceId,
        productId: product.id,
        channel: "web",
        amountCents: input.amountCents,
        validFrom: validFrom.toISOString(),
        scheduled,
      },
    });
    return { priceId, validFrom: validFrom.toISOString(), scheduled };
  },
});
