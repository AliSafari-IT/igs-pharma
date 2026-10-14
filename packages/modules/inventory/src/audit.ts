import { z } from "zod";

import { ADJUST_REASONS, RELEASE_REASONS } from "./domain";

/** Audit actions recorded by the inventory commands (`<domain>.<noun>.<verb>`). */
export const INVENTORY_AUDIT = {
  stockImportPrepared: "inventory.stock.import_prepared",
  stockImported: "inventory.stock.imported",
  stockAdjusted: "inventory.stock.adjusted",
  reservationReserved: "inventory.reservation.reserved",
  reservationConfirmed: "inventory.reservation.confirmed",
  reservationReleased: "inventory.reservation.released",
  reservationConsumed: "inventory.reservation.consumed",
  reservationExpired: "inventory.reservation.expired",
} as const;

const stockImportPrepared = z.object({
  planId: z.uuid(),
  rows: z.number().int().min(1),
});
const stockImported = z.object({
  importId: z.uuid(),
  rows: z.number().int().min(0),
  changed: z.number().int().min(0),
});
const stockAdjusted = z.object({
  movementId: z.uuid(),
  productId: z.uuid(),
  delta: z.number().int(),
  reason: z.enum(ADJUST_REASONS),
});

/** Ids and a quantity only (D-028): never the holder reference, which is the holder's business. */
const reservationEvent = z.object({
  reservationId: z.uuid(),
  productId: z.uuid(),
  quantity: z.number().int().min(1),
});
const reservationReleased = reservationEvent.extend({ reason: z.enum(RELEASE_REASONS) });
const reservationConsumed = reservationEvent.extend({ movementId: z.uuid() });

/** The signature of `registerAuditAction` from `@igs/module-audit`. */
export type RegisterAuditAction = (action: string, data: z.ZodObject<z.ZodRawShape>) => void;

/**
 * Registers the inventory audit actions (identifiers and counts only, D-028; never the staff note
 * of an adjustment). Each composition root that runs inventory commands calls it once, before
 * `configureKernel`, passing `registerAuditAction` from `@igs/module-audit`.
 */
export function registerAuditActions(register: RegisterAuditAction): void {
  register(INVENTORY_AUDIT.stockImportPrepared, stockImportPrepared);
  register(INVENTORY_AUDIT.stockImported, stockImported);
  register(INVENTORY_AUDIT.stockAdjusted, stockAdjusted);
  register(INVENTORY_AUDIT.reservationReserved, reservationEvent);
  register(INVENTORY_AUDIT.reservationConfirmed, reservationEvent);
  register(INVENTORY_AUDIT.reservationReleased, reservationReleased);
  register(INVENTORY_AUDIT.reservationConsumed, reservationConsumed);
  register(INVENTORY_AUDIT.reservationExpired, reservationEvent);
}
