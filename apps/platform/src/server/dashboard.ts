import type { ResolvedActor } from "@igs/auth";
import { type ProductCounts, getProductCounts } from "@igs/module-catalog";
import { getStockSummary } from "@igs/module-inventory";
import { getStockShortSummary } from "@igs/module-orders";
import { listDsr } from "@igs/module-privacy";
import { logger } from "@igs/observability/logger";
import { PERMISSIONS, hasPermission } from "@igs/rbac";

import {
  type ReservationCounts,
  type StockAlerts,
  type TileResult,
  mapTile,
  settle,
} from "../lib/dashboard";

export interface RequestCounts {
  readonly open: number;
  readonly overdue: number;
}

/** A tile is `undefined` when the member lacks its permission: it is left out, not shown empty. */
export interface Dashboard {
  readonly products?: TileResult<ProductCounts>;
  readonly stock?: TileResult<StockAlerts>;
  readonly reservations?: TileResult<ReservationCounts>;
  readonly requests?: TileResult<RequestCounts>;
  /** No tile of its own: feeds "Needs attention" (paid orders short of stock, #158). */
  readonly orders?: TileResult<{ readonly stockShort: number; readonly overdue: number }>;
}

const report = (tile: string) => (error: unknown) =>
  logger.error(
    { event: "platform.dashboard_tile_failed", tile, err: error },
    "dashboard tile failed",
  );

/**
 * The dashboard's tiles (igs-pharma#115), each read through an exported query and each settled on
 * its own: one failing source gives that tile an error state and the others still render. A tile
 * is loaded only for a member who holds its permission (the queries check it again, D-005). The
 * stock alerts and active reservations tiles share one read, the inventory's stock summary.
 */
export async function loadDashboard(actor: ResolvedActor): Promise<Dashboard> {
  const can = (permission: Parameters<typeof hasPermission>[1]) =>
    hasPermission(actor.roles, permission);
  const [products, stockSummary, requests, orders] = await Promise.all([
    can(PERMISSIONS.catalog.productsRead)
      ? settle(() => getProductCounts({}, actor), report("products"))
      : undefined,
    can(PERMISSIONS.inventory.stockRead)
      ? settle(() => getStockSummary({}, actor), report("stock"))
      : undefined,
    can(PERMISSIONS.privacy.dsrRead)
      ? settle(async (): Promise<RequestCounts> => {
          const [received, inProgress] = await Promise.all([
            listDsr({ status: "received", pageSize: 1 }, actor),
            listDsr({ status: "in_progress", pageSize: 1 }, actor),
          ]);
          return { open: received.total + inProgress.total, overdue: received.overdueTotal };
        }, report("requests"))
      : undefined,
    can(PERMISSIONS.orders.read)
      ? settle(async () => {
          const { waiting, overdue } = await getStockShortSummary({}, actor);
          return { stockShort: waiting, overdue };
        }, report("orders"))
      : undefined,
  ]);
  return {
    ...(products ? { products } : {}),
    ...(stockSummary
      ? {
          stock: mapTile(
            stockSummary,
            ({ low, out, short, flaggedLots }): StockAlerts => ({ low, out, short, flaggedLots }),
          ),
          reservations: mapTile(
            stockSummary,
            ({ activeReservations }): ReservationCounts => ({ active: activeReservations }),
          ),
        }
      : {}),
    ...(requests ? { requests } : {}),
    ...(orders ? { orders } : {}),
  };
}
