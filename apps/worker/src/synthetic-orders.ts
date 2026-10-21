/**
 * The demo orders: one guest order per lifecycle state, so the back-office Orders area and the
 * order pages can be tried on staging and in development. Each goes through the real commands (cart,
 * checkout, place, a recorded payment status, review and fulfilment steps), so the database guards,
 * history and audit apply as for a real order. No payment provider is called: a paid order gets a
 * fake `tr_demo…` payment that is already in an end state, so the worker's reconciliation never
 * re-reads it. `seed-catalog.ts` runs it after the prices.
 *
 * Safe to run twice: an order is placed only when no order with its demo contact name exists.
 * A medicine is sold only once a pharmacist approved its text (D-034), which the seed cannot do: the
 * medicine orders are skipped until one demo medicine is approved, and a later run adds them.
 */
import { isDomainError } from "@igs/kernel";
import type { Actor } from "@igs/kernel";
import { listProducts } from "@igs/module-catalog";
import {
  PAYMENTS_ACTOR,
  advanceOrder,
  attachProviderPayment,
  decideReview,
  getOrderForStaff,
  listOrdersForStaff,
  newCartToken,
  placeOrder,
  recordPaymentStatus,
  setCartLine,
  startCheckout,
} from "@igs/module-orders";

import { PRODUCTS, SEED_ACTOR, cnkFor, demoStockFor } from "./synthetic-catalog";
import { SHORT_INDEX } from "./synthetic-reservations";

/** The shopper of the demo orders: a guest, like most real first orders. */
export const SEED_GUEST: Actor = { type: "anonymous", id: "seed-guest", roles: [] };

type Step = "approve" | "reject" | "preparing" | "ready_for_pickup" | "collected";

export interface DemoOrder {
  /** The contact name, and the key that makes a re-run skip it. */
  readonly name: string;
  readonly medicine: boolean;
  readonly quantity: number;
  /** `null`: left unpaid. */
  readonly payment: "paid" | "failed" | null;
  readonly steps: readonly Step[];
}

export const DEMO_ORDERS: readonly DemoOrder[] = [
  { name: "Demo – wacht op betaling", medicine: false, quantity: 1, payment: null, steps: [] },
  { name: "Demo – bij de apotheker", medicine: true, quantity: 1, payment: "paid", steps: [] },
  { name: "Demo – klaar om te maken", medicine: false, quantity: 2, payment: "paid", steps: [] },
  {
    name: "Demo – wordt klaargemaakt",
    medicine: false,
    quantity: 1,
    payment: "paid",
    steps: ["preparing"],
  },
  {
    name: "Demo – klaar om af te halen",
    medicine: true,
    quantity: 1,
    payment: "paid",
    steps: ["approve", "preparing", "ready_for_pickup"],
  },
  {
    name: "Demo – afgehaald",
    medicine: false,
    quantity: 1,
    payment: "paid",
    steps: ["preparing", "ready_for_pickup", "collected"],
  },
  { name: "Demo – betaling mislukt", medicine: false, quantity: 1, payment: "failed", steps: [] },
  {
    name: "Demo – afgekeurd",
    medicine: true,
    quantity: 1,
    payment: "paid",
    steps: ["reject"],
  },
];

export interface OrderSeedResult {
  /** Demo orders placed by this run. */
  readonly placed: number;
  /** Demo orders already there, or that could not be placed (no sellable product yet). */
  readonly skipped: number;
}

const isMedicineType = (type: string) => type === "otc_medicine";

/** Seed products a demo order may use: active, approved, and not the deliberately short one. */
function candidates(medicine: boolean): number[] {
  return PRODUCTS.flatMap((seed, index) =>
    seed.status === "active" &&
    !seed.review &&
    isMedicineType(seed.type) === medicine &&
    index !== SHORT_INDEX &&
    demoStockFor(index) >= 4
      ? [index]
      : [],
  );
}

async function existingNames(actor: Actor): Promise<Set<string>> {
  const names = new Set<string>();
  for (let page = 1; ; page++) {
    const result = await listOrdersForStaff({ page, pageSize: 100 }, actor);
    for (const item of result.items) if (item.contactName) names.add(item.contactName);
    if (page * result.pageSize >= result.total) return names;
  }
}

/** Fills a fresh guest cart with one seed product, trying the candidates in order. */
async function fillCart(token: string, demo: DemoOrder, actor: Actor): Promise<boolean> {
  for (const index of candidates(demo.medicine)) {
    const [item] = (await listProducts({ cnk: cnkFor(index), pageSize: 1 }, actor)).items;
    if (!item) continue;
    try {
      await setCartLine(
        { cartToken: token, productId: item.id, quantity: demo.quantity },
        SEED_GUEST,
      );
      return true;
    } catch (error) {
      // not visible in the shop (no price, out of stock): try the next one
      if (!isDomainError(error)) throw error;
    }
  }
  return false;
}

async function place(demo: DemoOrder, index: number, actor: Actor): Promise<boolean> {
  const token = newCartToken();
  if (!(await fillCart(token, demo, actor))) return false;
  const { checkoutId } = await startCheckout({ cartToken: token, locale: "nl" }, SEED_GUEST);
  const { orderId, paymentId } = await placeOrder(
    {
      cartToken: token,
      checkoutId,
      contact: {
        name: demo.name,
        email: `demo-order-${index + 1}@example.test`,
        phone: "+32470000000",
      },
    },
    SEED_GUEST,
  );
  if (demo.payment) {
    const view = await getOrderForStaff({ orderId }, actor);
    const providerPaymentId = `tr_demo${String(index + 1).padStart(4, "0")}${orderId.slice(-8)}`;
    await attachProviderPayment(
      { paymentId, providerPaymentId, checkoutUrl: null, status: "open" },
      PAYMENTS_ACTOR,
    );
    await recordPaymentStatus(
      {
        providerPaymentId,
        status: demo.payment,
        amountCents: view.totalCents,
        currency: "EUR",
      },
      PAYMENTS_ACTOR,
    );
  }
  for (const step of demo.steps) {
    const { version } = await getOrderForStaff({ orderId }, actor);
    if (step === "approve" || step === "reject") {
      await decideReview(
        {
          orderId,
          decision: step === "approve" ? "approved" : "rejected",
          note: "Demo",
          expectedVersion: version,
        },
        actor,
      );
    } else {
      await advanceOrder({ orderId, to: step, expectedVersion: version }, actor);
    }
  }
  return true;
}

export async function seedSyntheticOrders(actor: Actor = SEED_ACTOR): Promise<OrderSeedResult> {
  const names = await existingNames(actor);
  let placed = 0;
  let skipped = 0;
  for (const [index, demo] of DEMO_ORDERS.entries()) {
    if (names.has(demo.name) || !(await place(demo, index, actor))) {
      skipped++;
      continue;
    }
    placed++;
  }
  return { placed, skipped };
}
