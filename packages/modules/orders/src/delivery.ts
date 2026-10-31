import { type Tx, command, query, validationFailed } from "@igs/kernel";
import { requireFreshMfa } from "@igs/module-identity";
import { PERMISSIONS } from "@igs/rbac";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { ORDERS_AUDIT } from "./audit";
import {
  DELIVERY_DEFAULTS,
  type DeliveryRates,
  isValidDeliveryPrice,
  isValidFreeFrom,
} from "./delivery-domain";
import { deliverySettings } from "./schema";

/**
 * Home-delivery settings (igs-pharma#202): the price and the free-delivery value staff set in the
 * back-office. One row; with no row the defaults apply and callers are told so (`isDefault`).
 */

/** The rates in force, and where they come from. */
export interface DeliverySettings extends DeliveryRates {
  /** `true` while staff have never set a value: the plan's placeholder defaults are in force. */
  readonly isDefault: boolean;
  readonly version: number;
  readonly updatedAt: Date | null;
}

/**
 * Reads the rates from the database on every call (never cached: a staff change applies to the next
 * request). Authorization is the CALLER's: the back-office query below needs the manage permission,
 * the storefront and checkout read it as part of the page or the order they already serve.
 */
export async function loadDeliverySettings(tx: Tx): Promise<DeliverySettings> {
  const [row] = await tx
    .select({
      priceCents: deliverySettings.priceCents,
      freeFromCents: deliverySettings.freeFromCents,
      version: deliverySettings.version,
      updatedAt: deliverySettings.updatedAt,
    })
    .from(deliverySettings)
    .where(eq(deliverySettings.key, "delivery"))
    .limit(1);
  if (!row) return { ...DELIVERY_DEFAULTS, isDefault: true, version: 0, updatedAt: null };
  return { ...row, isDefault: false };
}

/** The rates in force, for the back-office page (`orders.delivery_settings.manage`). */
export const getDeliverySettings = query({
  name: "orders.delivery_settings.get",
  input: z.object({}),
  permission: PERMISSIONS.orders.deliverySettingsManage,
  async handler({ ctx }): Promise<DeliverySettings> {
    return loadDeliverySettings(ctx.tx);
  },
});

/**
 * Sets the price and the free-delivery value (the owner and the pharmacist-titular), from now on.
 * Needs a fresh passkey check (`identity.fresh_mfa_required`) and is audited with amounts only.
 * Errors: `orders.delivery_price_invalid` (a whole number of cents from 0 to the limit),
 * `orders.delivery_free_from_invalid` (empty, or the same range). The proof check runs AFTER the
 * validation, so a refused attempt changes nothing and its idempotency key stays unused.
 */
export const setDeliverySettings = command({
  name: "orders.delivery_settings.set",
  input: z.object({
    priceCents: z.number(),
    /** `null`: delivery is never free. */
    freeFromCents: z.number().nullable(),
  }),
  output: z.object({ version: z.number().int() }),
  permission: PERMISSIONS.orders.deliverySettingsManage,
  async handler({ input, ctx }) {
    if (!isValidDeliveryPrice(input.priceCents)) {
      throw validationFailed("orders.delivery_price_invalid", [
        { path: "priceCents", code: "orders.delivery_price_invalid" },
      ]);
    }
    if (!isValidFreeFrom(input.freeFromCents)) {
      throw validationFailed("orders.delivery_free_from_invalid", [
        { path: "freeFromCents", code: "orders.delivery_free_from_invalid" },
      ]);
    }
    requireFreshMfa(ctx);

    const [previous] = await ctx.tx
      .select({
        priceCents: deliverySettings.priceCents,
        freeFromCents: deliverySettings.freeFromCents,
      })
      .from(deliverySettings)
      .where(eq(deliverySettings.key, "delivery"))
      .limit(1);
    const [saved] = await ctx.tx
      .insert(deliverySettings)
      .values({
        key: "delivery",
        priceCents: input.priceCents,
        freeFromCents: input.freeFromCents,
        updatedByType: ctx.actor.type,
        updatedById: ctx.actor.id,
        updatedAt: ctx.now,
      })
      .onConflictDoUpdate({
        target: deliverySettings.key,
        set: {
          priceCents: input.priceCents,
          freeFromCents: input.freeFromCents,
          version: sql`${deliverySettings.version} + 1`,
          updatedByType: ctx.actor.type,
          updatedById: ctx.actor.id,
          updatedAt: ctx.now,
        },
      })
      .returning({ version: deliverySettings.version });
    const version = saved?.version ?? 1;
    await ctx.audit.record({
      action: ORDERS_AUDIT.deliverySettingsSet,
      entityType: "delivery_settings",
      entityId: "delivery",
      data: {
        priceCents: input.priceCents,
        freeFromCents: input.freeFromCents,
        previousPriceCents: previous?.priceCents ?? null,
        previousFreeFromCents: previous ? previous.freeFromCents : null,
        version,
      },
    });
    return { version };
  },
});
