import { z } from "zod";

import { ADJUST_REASONS, ALLOCATION_CAUSES, QUARANTINE_REASONS, RELEASE_REASONS } from "./domain";

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
  stockReceived: "inventory.stock.received",
  stockReturned: "inventory.stock.returned",
  lotAssigned: "inventory.lot.assigned",
  lotQuarantined: "inventory.lot.quarantined",
  lotReleased: "inventory.lot.released",
  expiryBufferSet: "inventory.settings.expiry_buffer_set",
  allocationAllocated: "inventory.allocation.allocated",
  allocationSuperseded: "inventory.allocation.superseded",
  allocationShort: "inventory.allocation.short",
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
  lotId: z.uuid(),
  delta: z.number().int(),
  reason: z.enum(ADJUST_REASONS),
});

/** igs-pharma#164: ids and quantities; never the staff note, the lot number or the expiry date. */
const stockLotMovement = z.object({
  movementId: z.uuid(),
  productId: z.uuid(),
  lotId: z.uuid(),
  quantity: z.number().int().min(1),
});
const lotAssigned = z.object({
  productId: z.uuid(),
  fromLotId: z.uuid(),
  lotId: z.uuid(),
  quantity: z.number().int().min(1),
});
const lotQuarantine = z.object({
  productId: z.uuid(),
  lotId: z.uuid(),
  reason: z.enum(QUARANTINE_REASONS),
});
const expiryBufferSet = z.object({
  from: z.number().int().min(0),
  to: z.number().int().min(0),
});

/** Ids and a quantity only (D-028): never the holder reference, which is the holder's business. */
const reservationEvent = z.object({
  reservationId: z.uuid(),
  productId: z.uuid(),
  quantity: z.number().int().min(1),
});
const reservationReleased = reservationEvent.extend({ reason: z.enum(RELEASE_REASONS) });
const reservationConsumed = reservationEvent.extend({ movementId: z.uuid() });

/** igs-pharma#165: one entry per lot share of an order, with ids, the quantity and the cause. */
const allocationEvent = z.object({
  allocationId: z.uuid(),
  reservationId: z.uuid(),
  productId: z.uuid(),
  lotId: z.uuid(),
  quantity: z.number().int().min(1),
  cause: z.enum(ALLOCATION_CAUSES),
});
const allocationShort = z.object({
  reservationId: z.uuid(),
  productId: z.uuid(),
  quantity: z.number().int().min(1),
  allocated: z.number().int().min(0),
  cause: z.enum(ALLOCATION_CAUSES),
});

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
  register(INVENTORY_AUDIT.stockReceived, stockLotMovement);
  register(INVENTORY_AUDIT.stockReturned, stockLotMovement);
  register(INVENTORY_AUDIT.lotAssigned, lotAssigned);
  register(INVENTORY_AUDIT.lotQuarantined, lotQuarantine);
  register(INVENTORY_AUDIT.lotReleased, lotQuarantine);
  register(INVENTORY_AUDIT.expiryBufferSet, expiryBufferSet);
  register(INVENTORY_AUDIT.allocationAllocated, allocationEvent);
  register(INVENTORY_AUDIT.allocationSuperseded, allocationEvent);
  register(INVENTORY_AUDIT.allocationShort, allocationShort);
}
