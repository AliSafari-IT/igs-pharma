import { type Actor, type Ctx, command, conflict, defineEvent, notFound, query } from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";

import { ORDERS_AUDIT } from "./audit";
import {
  SHIPMENT_FAILURE_CODE,
  SHIPMENT_TRANSITIONS,
  type ShipmentStatus,
  isTrackingUrl,
} from "./delivery-domain";
import { MINUTE_MS, type OrderLocale, type OrderStatus } from "./domain";
import { orderAddresses, orderContacts, ordersTable, shipments } from "./schema";

/**
 * Parcels of home-delivery orders (igs-pharma#202, part 3). Staff pack a delivery order
 * (`ready_to_ship`): the same transaction records its shipment (`requested`) and publishes
 * `orders.shipment.requested`. The WORKER asks Sendcloud for the parcel and its label, outside any
 * transaction (D-019), and records the answer (`recordShipmentOutcome`): the parcel id, then the
 * tracking number and link (`created`), or a refusal (`failed`, staff ask again). Our shipment id is
 * the parcel's external reference, so a retry finds the parcel already made instead of paying for a
 * second label. A packed order that is cancelled asks the worker to cancel its parcel
 * (`cancel_requested` → `cancelled`). Once the order is shipped, the worker's reconciliation reads
 * the parcel and moves the order to `delivered` when the carrier says so.
 *
 * The module never talks to Sendcloud: the worker passes a `ShippingProvider` in (structural, so this
 * module does not import `@igs/shipping`).
 */

/** Ids only (D-020): the worker reads the rest when it runs. */
export const ShipmentRequested = defineEvent(
  "orders.shipment.requested",
  1,
  z.object({ shipmentId: z.uuid(), orderId: z.uuid() }),
);

/** The worker's identity for shipments: `system_shipping` (`orders.shipment.manage`, system-only). */
export const SHIPPING_ACTOR: Actor = { type: "system", id: "shipping", roles: ["system_shipping"] };

type Shipment = typeof shipments.$inferSelect;

async function lockShipmentOf(ctx: Ctx, orderId: string): Promise<Shipment | null> {
  const [row] = await ctx.tx
    .select()
    .from(shipments)
    .where(eq(shipments.orderId, orderId))
    .for("update");
  return row ?? null;
}

async function moveShipment(
  ctx: Ctx,
  shipment: Shipment,
  to: ShipmentStatus,
  set: Partial<typeof shipments.$inferInsert> = {},
): Promise<void> {
  await ctx.tx
    .update(shipments)
    .set({ ...set, status: to, version: shipment.version + 1, updatedAt: ctx.now })
    .where(eq(shipments.id, shipment.id));
}

async function auditShipment(
  ctx: Ctx,
  shipment: Pick<Shipment, "id" | "orderId">,
  status: ShipmentStatus,
  extra: { readonly providerParcelId?: string | null; readonly failureCode?: string | null } = {},
): Promise<void> {
  await ctx.audit.record({
    action: ORDERS_AUDIT.shipmentChanged,
    entityType: "order",
    entityId: shipment.orderId,
    data: {
      orderId: shipment.orderId,
      shipmentId: shipment.id,
      status,
      providerParcelId: extra.providerParcelId ?? null,
      failureCode: extra.failureCode ?? null,
    },
  });
}

/**
 * Records the parcel of an order staff just packed (`ready_to_ship`; the caller moved it there) and
 * asks the worker for its label. A shipment that already exists (an order is packed once) is left.
 */
export async function requestShipment(ctx: Ctx, orderId: string): Promise<string> {
  const existing = await lockShipmentOf(ctx, orderId);
  if (existing) return existing.id;
  const [row] = await ctx.tx
    .insert(shipments)
    .values({ orderId, requestedAt: ctx.now, updatedAt: ctx.now })
    .returning({ id: shipments.id });
  if (!row) throw new Error("orders.shipment_not_stored");
  await auditShipment(ctx, { id: row.id, orderId }, "requested");
  await ctx.outbox.publish(ShipmentRequested, { shipmentId: row.id, orderId });
  return row.id;
}

/**
 * The order of a packed parcel is cancelled: asks the worker to cancel the parcel at Sendcloud (a
 * label not used is credited). Nothing to do without a shipment, or once it is cancelled.
 */
export async function cancelShipmentOf(ctx: Ctx, orderId: string): Promise<void> {
  const shipment = await lockShipmentOf(ctx, orderId);
  if (!shipment) return;
  const from = shipment.status as ShipmentStatus;
  if (!SHIPMENT_TRANSITIONS[from].includes("cancel_requested")) return;
  await moveShipment(ctx, shipment, "cancel_requested");
  await auditShipment(ctx, shipment, "cancel_requested", {
    providerParcelId: shipment.providerParcelId,
  });
  await ctx.outbox.publish(ShipmentRequested, { shipmentId: shipment.id, orderId });
}

/**
 * Staff ask again for a label Sendcloud refused (`failed` → `requested`), typically after fixing the
 * parcel in Sendcloud's panel. `orders.shipment_not_failed` when there is nothing to retry.
 */
export const retryShipment = command({
  name: "orders.shipment.retry",
  input: z.object({ orderId: z.uuid() }),
  output: z.object({ shipmentId: z.uuid(), status: z.string() }),
  permission: PERMISSIONS.orders.manage,
  audit: "none",
  async handler({ input, ctx }) {
    const [order] = await ctx.tx
      .select({ status: ordersTable.status })
      .from(ordersTable)
      .where(eq(ordersTable.id, input.orderId))
      .for("update");
    if (!order) throw notFound("orders.order_not_found");
    const shipment = await lockShipmentOf(ctx, input.orderId);
    if (!shipment || shipment.status !== "failed" || order.status !== "ready_to_ship") {
      throw conflict("orders.shipment_not_failed", { status: shipment?.status ?? "none" });
    }
    await moveShipment(ctx, shipment, "requested", { failureCode: null });
    await auditShipment(ctx, shipment, "requested", {
      providerParcelId: shipment.providerParcelId,
    });
    await ctx.outbox.publish(ShipmentRequested, {
      shipmentId: shipment.id,
      orderId: input.orderId,
    });
    return { shipmentId: shipment.id, status: "requested" };
  },
});

// ── staff and customer reads ─────────────────────────────────────────────────────────────────────

/** A parcel as staff see it (no address: that is the order's). */
export interface ShipmentView {
  readonly shipmentId: string;
  readonly status: ShipmentStatus;
  readonly providerParcelId: string | null;
  readonly trackingNumber: string | null;
  readonly trackingUrl: string | null;
  readonly carrier: string | null;
  readonly failureCode: string | null;
  readonly requestedAt: Date;
  readonly labelCreatedAt: Date | null;
}

/** The order's parcel, or `null` (a pickup order, or a delivery order not packed yet). */
export async function shipmentOf(
  ctx: { readonly tx: Ctx["tx"] },
  orderId: string,
): Promise<ShipmentView | null> {
  const [row] = await ctx.tx
    .select({
      shipmentId: shipments.id,
      status: shipments.status,
      providerParcelId: shipments.providerParcelId,
      trackingNumber: shipments.trackingNumber,
      trackingUrl: shipments.trackingUrl,
      carrier: shipments.carrier,
      failureCode: shipments.failureCode,
      requestedAt: shipments.requestedAt,
      labelCreatedAt: shipments.labelCreatedAt,
    })
    .from(shipments)
    .where(eq(shipments.orderId, orderId));
  return row ? { ...row, status: row.status as ShipmentStatus } : null;
}

/**
 * What the back-office's label route needs to fetch the label PDF from Sendcloud: the parcel id of
 * an order whose label exists and that is packed or shipped. Staff with `orders.order.manage` only.
 * `orders.shipment_label_missing` when there is no label to print.
 */
export const getShipmentLabel = query({
  name: "orders.shipment.label",
  input: z.object({ orderId: z.uuid() }),
  permission: PERMISSIONS.orders.manage,
  async handler({
    input,
    ctx,
  }): Promise<{ readonly parcelId: string; readonly reference: string }> {
    const [row] = await ctx.tx
      .select({
        status: shipments.status,
        parcelId: shipments.providerParcelId,
        orderStatus: ordersTable.status,
        reference: ordersTable.reference,
      })
      .from(shipments)
      .innerJoin(ordersTable, eq(ordersTable.id, shipments.orderId))
      .where(eq(shipments.orderId, input.orderId));
    if (
      !row ||
      row.status !== "created" ||
      !row.parcelId ||
      !["ready_to_ship", "shipped"].includes(row.orderStatus)
    ) {
      throw conflict("orders.shipment_label_missing");
    }
    return { parcelId: row.parcelId, reference: row.reference };
  },
});

// ── worker side ──────────────────────────────────────────────────────────────────────────────────

/** A parcel as the provider describes it (Sendcloud's client returns this shape). */
export interface ProviderParcelView {
  readonly id: string;
  readonly statusId: number;
  readonly trackingNumber: string | null;
  readonly trackingUrl: string | null;
  readonly carrier: string | null;
  readonly externalReference: string | null;
}

/** What the module needs from a carrier platform (the Sendcloud client fits it). */
export interface ShippingProvider {
  createParcel(input: {
    readonly externalReference: string;
    readonly orderNumber: string;
    readonly name: string;
    readonly street: string;
    readonly postalCode: string;
    readonly city: string;
    readonly country: string;
    readonly email: string;
    readonly phone: string;
    readonly shippingMethodId: number;
    readonly weightGrams: number;
  }): Promise<ProviderParcelView>;
  getParcel(id: string): Promise<ProviderParcelView>;
  findParcel(externalReference: string): Promise<ProviderParcelView | null>;
  cancelParcel(id: string): Promise<"cancelled" | "queued" | "gone">;
}

/** How labels are made: from the environment (`SENDCLOUD_SHIPPING_METHOD_ID`, the weight). */
export interface ShippingSettings {
  readonly shippingMethodId: number;
  readonly weightGrams: number;
}

/**
 * The parcel statuses that end an announcement or a delivery (the Sendcloud ids; see
 * `@igs/shipping`'s `SENDCLOUD_STATUS`). Kept here as numbers so the module does not import it.
 */
export const PARCEL_STATUS = {
  delivered: [11, 93] as readonly number[],
  announcementFailed: 1002,
};

export interface ShipmentForExecution {
  readonly shipmentId: string;
  readonly orderId: string;
  readonly status: ShipmentStatus;
  readonly orderStatus: OrderStatus;
  readonly reference: string;
  readonly locale: OrderLocale;
  readonly providerParcelId: string | null;
  /** The parcel's address and contact, for the label (personal data: the worker passes it on only). */
  readonly recipient: {
    readonly name: string;
    readonly email: string;
    readonly phone: string;
    readonly street: string;
    readonly postalCode: string;
    readonly city: string;
    readonly country: string;
  } | null;
}

export const getShipmentForExecution = query({
  name: "orders.shipment.for_execution",
  input: z.object({ shipmentId: z.uuid() }),
  permission: PERMISSIONS.orders.shipmentManage,
  async handler({ input, ctx }): Promise<ShipmentForExecution> {
    const [row] = await ctx.tx
      .select({
        shipmentId: shipments.id,
        orderId: shipments.orderId,
        status: shipments.status,
        orderStatus: ordersTable.status,
        reference: ordersTable.reference,
        locale: ordersTable.locale,
        providerParcelId: shipments.providerParcelId,
        name: orderContacts.name,
        email: orderContacts.email,
        phone: orderContacts.phone,
        street: orderAddresses.street,
        postalCode: orderAddresses.postalCode,
        city: orderAddresses.city,
        country: orderAddresses.country,
      })
      .from(shipments)
      .innerJoin(ordersTable, eq(ordersTable.id, shipments.orderId))
      .leftJoin(orderContacts, eq(orderContacts.orderId, shipments.orderId))
      .leftJoin(orderAddresses, eq(orderAddresses.orderId, shipments.orderId))
      .where(eq(shipments.id, input.shipmentId));
    if (!row) throw notFound("orders.shipment_not_found");
    const { name, email, phone, street, postalCode, city, country, ...rest } = row;
    return {
      ...rest,
      status: row.status as ShipmentStatus,
      orderStatus: row.orderStatus as OrderStatus,
      locale: row.locale as OrderLocale,
      recipient:
        name !== null &&
        email !== null &&
        phone !== null &&
        street !== null &&
        postalCode !== null &&
        city !== null &&
        country !== null
          ? { name, email, phone, street, postalCode, city, country }
          : null,
    };
  },
});

/**
 * The shipments the reconciliation looks at: those waiting for the worker (a label or a cancellation
 * not done after `quietMinutes`: a lost job, Sendcloud still announcing), and the parcels of shipped
 * orders (for the delivery), oldest change first.
 */
export const listShipmentsToSync = query({
  name: "orders.shipment.list_to_sync",
  input: z.object({
    quietMinutes: z.number().int().min(1).max(1440),
    limit: z.number().int().min(1).max(500),
  }),
  permission: PERMISSIONS.orders.shipmentManage,
  async handler({ input, ctx }): Promise<readonly string[]> {
    const before = new Date(ctx.now.getTime() - input.quietMinutes * MINUTE_MS);
    const waiting = await ctx.tx
      .select({ id: shipments.id })
      .from(shipments)
      .where(
        and(
          inArray(shipments.status, ["requested", "cancel_requested"]),
          lte(shipments.updatedAt, before),
        ),
      )
      .orderBy(asc(shipments.updatedAt))
      .limit(input.limit);
    const shipped = await ctx.tx
      .select({ id: shipments.id })
      .from(shipments)
      .innerJoin(ordersTable, eq(ordersTable.id, shipments.orderId))
      .where(and(eq(shipments.status, "created"), eq(ordersTable.status, "shipped")))
      .orderBy(asc(ordersTable.updatedAt))
      .limit(input.limit);
    return [...waiting, ...shipped].map((row) => row.id);
  },
});

const parcelId = z.string().regex(/^[0-9]{1,20}$/);

/** What the worker saw at Sendcloud (see `recordShipmentOutcome`). */
export type ShipmentOutcome =
  | {
      readonly kind: "parcel";
      readonly parcelId: string;
      readonly trackingNumber: string | null;
      readonly trackingUrl: string | null;
      readonly carrier: string | null;
    }
  | { readonly kind: "refused"; readonly parcelId: string | null; readonly code: string }
  | { readonly kind: "cancelled" };

/**
 * Records what Sendcloud said about a shipment. Forward only; a repeat changes nothing and is not
 * audited.
 * - `parcel`: the parcel exists (its id); with a tracking number, the label is made (`created`).
 *   A parcel that answers a cancellation request is only remembered, the cancellation goes on.
 * - `refused`: Sendcloud refused the label (`failed`, with a code staff see).
 * - `cancelled`: the parcel was cancelled at Sendcloud, or never existed (`cancelled`).
 * `orders.shipment_parcel_mismatch` when Sendcloud names another parcel than the one recorded.
 */
export const recordShipmentOutcome = command({
  name: "orders.shipment.record_outcome",
  input: z.object({
    shipmentId: z.uuid(),
    outcome: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("parcel"),
        parcelId,
        trackingNumber: z.string().min(1).max(64).nullable(),
        trackingUrl: z.string().max(500).nullable(),
        carrier: z.string().min(1).max(40).nullable(),
      }),
      z.object({ kind: z.literal("refused"), parcelId: parcelId.nullable(), code: z.string() }),
      z.object({ kind: z.literal("cancelled") }),
    ]),
  }),
  output: z.object({ shipmentId: z.uuid(), status: z.string(), changed: z.boolean() }),
  permission: PERMISSIONS.orders.shipmentManage,
  audit: "none",
  async handler({ input, ctx }) {
    const [shipment] = await ctx.tx
      .select()
      .from(shipments)
      .where(eq(shipments.id, input.shipmentId))
      .for("update");
    if (!shipment) throw notFound("orders.shipment_not_found");
    const from = shipment.status as ShipmentStatus;
    const unchanged = { shipmentId: shipment.id, status: from, changed: false };
    const { outcome } = input;
    const named = outcome.kind === "cancelled" ? null : outcome.parcelId;
    if (named && shipment.providerParcelId && named !== shipment.providerParcelId) {
      throw conflict("orders.shipment_parcel_mismatch");
    }
    const parcelSet = named && !shipment.providerParcelId ? { providerParcelId: named } : {};

    if (outcome.kind === "cancelled") {
      if (from !== "cancel_requested") return unchanged;
      await moveShipment(ctx, shipment, "cancelled");
      await auditShipment(ctx, shipment, "cancelled", {
        providerParcelId: shipment.providerParcelId,
      });
      return { shipmentId: shipment.id, status: "cancelled", changed: true };
    }
    if (outcome.kind === "refused") {
      if (from !== "requested") return unchanged;
      const code = SHIPMENT_FAILURE_CODE.test(outcome.code) ? outcome.code : "provider_refused";
      await moveShipment(ctx, shipment, "failed", { ...parcelSet, failureCode: code });
      await auditShipment(ctx, shipment, "failed", {
        providerParcelId: named ?? shipment.providerParcelId,
        failureCode: code,
      });
      return { shipmentId: shipment.id, status: "failed", changed: true };
    }
    // a parcel
    const labelled = outcome.trackingNumber !== null;
    if (from === "requested" && labelled) {
      await moveShipment(ctx, shipment, "created", {
        ...parcelSet,
        trackingNumber: outcome.trackingNumber,
        trackingUrl:
          outcome.trackingUrl && isTrackingUrl(outcome.trackingUrl) ? outcome.trackingUrl : null,
        carrier: outcome.carrier,
        labelCreatedAt: ctx.now,
      });
      await auditShipment(ctx, shipment, "created", {
        providerParcelId: named ?? shipment.providerParcelId,
      });
      return { shipmentId: shipment.id, status: "created", changed: true };
    }
    // still announcing, or a cancellation under way: only the parcel id is new
    if (
      !("providerParcelId" in parcelSet) ||
      (from !== "requested" && from !== "cancel_requested")
    ) {
      return unchanged;
    }
    await moveShipment(ctx, shipment, from, parcelSet);
    return { shipmentId: shipment.id, status: from, changed: true };
  },
});

/**
 * The carrier delivered a shipped order: `shipped` → `delivered`. Recorded by the worker (Sendcloud's
 * parcel status); staff record it with `advanceOrder` when the carrier says nothing. A repeat, or an
 * order no longer shipped (returned meanwhile), changes nothing.
 */
export const recordDelivered = command({
  name: "orders.shipment.record_delivered",
  input: z.object({ shipmentId: z.uuid() }),
  output: z.object({ orderId: z.uuid(), changed: z.boolean() }),
  permission: PERMISSIONS.orders.shipmentManage,
  audit: "none",
  async handler({ input, ctx }) {
    const [row] = await ctx.tx
      .select({ orderId: shipments.orderId })
      .from(shipments)
      .where(eq(shipments.id, input.shipmentId));
    if (!row) throw notFound("orders.shipment_not_found");
    const [order] = await ctx.tx
      .select({ id: ordersTable.id, status: ordersTable.status, version: ordersTable.version })
      .from(ordersTable)
      .where(eq(ordersTable.id, row.orderId))
      .for("update");
    if (!order || order.status !== "shipped") return { orderId: row.orderId, changed: false };
    await ctx.tx
      .update(ordersTable)
      .set({
        status: "delivered",
        version: order.version + 1,
        updatedByType: ctx.actor.type,
        updatedById: ctx.actor.id,
        updatedAt: ctx.now,
      })
      .where(eq(ordersTable.id, order.id));
    await ctx.audit.record({
      action: ORDERS_AUDIT.orderAdvanced,
      entityType: "order",
      entityId: order.id,
      data: { orderId: order.id, from: "shipped", to: "delivered" },
    });
    return { orderId: order.id, changed: true };
  },
});

/**
 * A refusal Sendcloud will repeat (a 4xx other than a timeout or rate limit). Anything else (the
 * network, a 5xx) is thrown again so the job retries.
 */
function refusalCode(error: unknown): string | null {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number" || status < 400 || status >= 500) return null;
  if (status === 408 || status === 429) return null;
  if (status === 401 || status === 403) return "provider_unauthorized";
  return status === 404 ? "provider_not_found" : "provider_refused";
}

const parcelOutcome = (parcel: ProviderParcelView) =>
  parcel.statusId === PARCEL_STATUS.announcementFailed
    ? ({ kind: "refused", parcelId: parcel.id, code: "announcement_failed" } as const)
    : ({
        kind: "parcel",
        parcelId: parcel.id,
        trackingNumber: parcel.trackingNumber,
        trackingUrl: parcel.trackingUrl,
        carrier: parcel.carrier,
      } as const);

export interface ShipmentSyncResult {
  readonly shipmentId: string;
  readonly status: ShipmentStatus;
  readonly changed: boolean;
  /** The order moved to `delivered` in this run. */
  readonly delivered: boolean;
}

/**
 * Brings one shipment to where it should be, talking to Sendcloud outside any transaction: makes the
 * label of a `requested` one (finding the parcel already made for our id first), cancels the parcel
 * of a `cancel_requested` one, and moves a shipped order to `delivered` when the carrier says so.
 * Safe to run any number of times. `settings` is `null` while labels are not set up: requested
 * shipments then wait.
 */
export async function syncShipment(
  shipmentId: string,
  provider: ShippingProvider,
  settings: ShippingSettings | null,
  actor: Actor = SHIPPING_ACTOR,
): Promise<ShipmentSyncResult> {
  let shipment = await getShipmentForExecution({ shipmentId }, actor);
  let changed = false;
  let delivered = false;
  const record = async (outcome: ShipmentOutcome) => {
    const result = await recordShipmentOutcome({ shipmentId, outcome }, actor);
    changed ||= result.changed;
    shipment = await getShipmentForExecution({ shipmentId }, actor);
  };

  if (shipment.status === "requested" && settings && shipment.recipient) {
    let parcel: ProviderParcelView;
    try {
      parcel = shipment.providerParcelId
        ? await provider.getParcel(shipment.providerParcelId)
        : ((await provider.findParcel(shipment.shipmentId)) ??
          (await provider.createParcel({
            externalReference: shipment.shipmentId,
            orderNumber: shipment.reference,
            ...shipment.recipient,
            shippingMethodId: settings.shippingMethodId,
            weightGrams: settings.weightGrams,
          })));
    } catch (error) {
      const code = refusalCode(error);
      if (!code) throw error;
      await record({ kind: "refused", parcelId: null, code });
      return { shipmentId, status: shipment.status, changed, delivered };
    }
    await record(parcelOutcome(parcel));
  }

  if (shipment.status === "cancel_requested") {
    const id = shipment.providerParcelId ?? (await provider.findParcel(shipment.shipmentId))?.id;
    const outcome = id ? await provider.cancelParcel(id) : "gone";
    if (outcome !== "queued") await record({ kind: "cancelled" });
  }

  if (
    shipment.status === "created" &&
    shipment.orderStatus === "shipped" &&
    shipment.providerParcelId
  ) {
    const parcel = await provider.getParcel(shipment.providerParcelId);
    if (PARCEL_STATUS.delivered.includes(parcel.statusId)) {
      const result = await recordDelivered({ shipmentId }, actor);
      delivered = result.changed;
      changed ||= result.changed;
    }
  }
  return { shipmentId, status: shipment.status, changed, delivered };
}
