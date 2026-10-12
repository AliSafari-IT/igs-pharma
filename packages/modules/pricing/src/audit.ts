import { z } from "zod";

import { PRICE_CHANNELS } from "./domain";

/** Audit actions recorded by the pricing commands (`<domain>.<noun>.<verb>`). */
export const PRICING_AUDIT = {
  priceSet: "pricing.price.set",
} as const;

const priceSet = z.object({
  priceId: z.uuid(),
  productId: z.uuid(),
  channel: z.enum(PRICE_CHANNELS),
  amountCents: z.number().int().positive(),
  validFrom: z.iso.datetime(),
  scheduled: z.boolean(),
});

/** The signature of `registerAuditAction` from `@igs/module-audit`. */
export type RegisterAuditAction = (action: string, data: z.ZodObject<z.ZodRawShape>) => void;

/**
 * Registers the pricing audit actions (identifiers and amounts only, D-028; never the staff
 * reason). Each composition root that runs pricing commands calls it once, before
 * `configureKernel`, passing `registerAuditAction` from `@igs/module-audit`.
 */
export function registerAuditActions(register: RegisterAuditAction): void {
  register(PRICING_AUDIT.priceSet, priceSet);
}
