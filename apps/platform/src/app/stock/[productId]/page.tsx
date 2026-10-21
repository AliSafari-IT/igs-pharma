import { isDomainError } from "@igs/kernel";
import { type ProductStock, getStock } from "@igs/module-inventory";
import { PERMISSIONS, hasPermission } from "@igs/rbac";
import { Alert, Badge, Container, EmptyState, Link, Stack } from "@igs/ui";

import { AdjustDialog } from "../../../components/adjust-dialog";
import {
  AssignLotDialog,
  QuarantineDialog,
  ReceiveDialog,
  ReleaseLotButton,
  ReturnDialog,
} from "../../../components/lot-dialogs";
import { PageHeader } from "../../../components/page-header";
import { ReleaseDialog } from "../../../components/release-dialog";
import {
  KIND_LABELS,
  REASON_LABELS,
  formatAge,
  formatDate,
  formatMoment,
  lotLabel,
  lotState,
  stockErrorMessage,
} from "../../../components/stock-labels";
import { requireStaffActor } from "../../../server/actor";
import { ensureKernelConfigured } from "../../../server/kernel";

export const metadata = { title: "Stock history · IGS-Pharma Platform" };

interface Props {
  readonly params: Promise<{ productId: string }>;
  readonly searchParams: Promise<{
    adjusted?: string | string[];
    released?: string | string[];
    done?: string | string[];
  }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** What a lot action changed (igs-pharma#164). */
const DONE: Record<string, string> = {
  received: "The stock was received into its lot.",
  returned: "The stock was returned to the pharmacy.",
  assigned: "The lot was recorded.",
  quarantined: "The lot is in quarantine: it can't be sold or picked.",
  released_lot: "The lot is back on sale.",
};

/** One product's on-hand and movement history, newest first, with the Adjust dialog. */
export default async function ProductStockPage({ params, searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const { productId } = await params;
  const { adjusted, released, done } = await searchParams;
  const doneText = DONE[first(done) ?? ""];
  const canQuarantine = hasPermission(actor.roles, PERMISSIONS.inventory.lotsQuarantine);
  const now = new Date();

  let stock: ProductStock | null = null;
  let error: string | null = null;
  if (!UUID.test(productId)) {
    error = "inventory.product_not_found";
  } else {
    try {
      stock = await getStock({ productId }, actor);
    } catch (e) {
      if (!isDomainError(e)) throw e;
      error = e.code;
    }
  }
  const lotNames = new Map((stock?.lots ?? []).map((lot) => [lot.lotId, lotLabel(lot)]));
  const who = (m: ProductStock["movements"][number]) =>
    m.actorType === "user"
      ? m.actorId === actor.id
        ? "You"
        : "Staff member"
      : m.actorId === "seed-catalog"
        ? "Demo data"
        : "System";

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          {stock ? (
            <PageHeader
              title={stock.nameNl ?? "No Dutch name yet"}
              back={{ href: "/stock", label: "Back to stock" }}
              description={
                <>
                  CNK <code>{stock.cnk}</code> · Saint-Gilles pharmacy
                </>
              }
              action={
                <div className="flex flex-wrap gap-3">
                  <ReceiveDialog productId={stock.productId} isMedicine={stock.isMedicine} />
                  <AdjustDialog
                    productId={stock.productId}
                    onHand={stock.onHand}
                    isMedicine={stock.isMedicine}
                    lots={stock.lots
                      .filter((lot) => lot.tracking !== "no_lot")
                      .map((lot) => ({
                        lotId: lot.lotId,
                        label: `${lotLabel(lot)}${lot.expiryDate ? ` · exp. ${formatDate(lot.expiryDate)}` : ""} · ${lot.onHand} on hand`,
                      }))}
                  />
                </div>
              }
            />
          ) : (
            <Link href="/stock">Back to stock</Link>
          )}

          {error ? (
            <Alert variant="error" title="You can't see this product's stock">
              {stockErrorMessage(error)}
            </Alert>
          ) : null}

          {stock ? (
            <>
              {first(adjusted) === "1" ? (
                <Alert variant="success" title="Stock changed">
                  On hand is now {stock.onHand}.
                </Alert>
              ) : null}

              {doneText ? (
                <Alert variant="success" title="Saved">
                  {doneText}
                </Alert>
              ) : null}

              {first(released) === "1" ? (
                <Alert variant="success" title="Stock released">
                  The reservation ended and its stock is available again.
                </Alert>
              ) : null}

              {stock.short > 0 ? (
                <Alert variant="error" title={`Short by ${stock.short}`}>
                  The orders set aside {stock.ordered} but only {stock.sellable} can be sold. Count
                  the shelf, restock, or release an order below.
                </Alert>
              ) : null}

              <p className="text-2xl">
                On hand: <strong data-testid="on-hand">{stock.onHand}</strong>
              </p>
              <dl className="flex flex-wrap gap-x-8 gap-y-1 text-[var(--color-text-subtle)]">
                <div className="flex gap-2">
                  <dt>In checkouts</dt>
                  <dd data-testid="held">{stock.held}</dd>
                </div>
                <div className="flex gap-2">
                  <dt>In orders</dt>
                  <dd data-testid="ordered">{stock.ordered}</dd>
                </div>
                <div className="flex gap-2">
                  <dt>Sellable</dt>
                  <dd data-testid="sellable">{stock.sellable}</dd>
                </div>
                <div className="flex gap-2">
                  <dt>Available</dt>
                  <dd data-testid="available">{stock.available}</dd>
                </div>
              </dl>

              <section aria-labelledby="lots-title" className="flex flex-col gap-3">
                <h2 id="lots-title" className="font-display text-2xl font-semibold">
                  Lots
                </h2>
                <p className="text-[var(--color-text-subtle)]">
                  Earliest expiry first; orders are picked in this order. A lot stops selling{" "}
                  {stock.expiryBufferDays} days before its expiry date.
                </p>
                {stock.lots.length === 0 ? (
                  <EmptyState title="No stock received yet" data-testid="lots-empty" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left" data-testid="lots">
                      <caption className="sr-only">Lots, earliest expiry first</caption>
                      <thead>
                        <tr className="border-b border-[var(--color-border-strong)]">
                          <th scope="col" className="py-2 pr-4 font-semibold">
                            Lot
                          </th>
                          <th scope="col" className="py-2 pr-4 font-semibold">
                            Expires
                          </th>
                          <th
                            scope="col"
                            className="py-2 pr-4 text-right font-semibold tabular-nums"
                          >
                            On hand
                          </th>
                          <th scope="col" className="py-2 pr-4 font-semibold">
                            State
                          </th>
                          <th scope="col" className="py-2 font-semibold">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {stock.lots.map((lot) => {
                          const state = lotState(lot);
                          const name = lotLabel(lot);
                          return (
                            <tr key={lot.lotId} className="border-b border-[var(--color-border)]">
                              <td className="py-2 pr-4">
                                {lot.tracking === "lot" ? <code>{name}</code> : name}
                              </td>
                              <td className="py-2 pr-4">
                                {lot.expiryDate ? formatDate(lot.expiryDate) : "—"}
                              </td>
                              <td className="py-2 pr-4 text-right tabular-nums">{lot.onHand}</td>
                              <td className="py-2 pr-4">
                                <Badge variant={state.variant}>{state.label}</Badge>
                              </td>
                              <td className="py-2">
                                <div className="flex flex-wrap gap-2">
                                  {lot.tracking === "unknown" && lot.onHand > 0 ? (
                                    <AssignLotDialog
                                      productId={stock.productId}
                                      onHand={lot.onHand}
                                      isMedicine={stock.isMedicine}
                                    />
                                  ) : null}
                                  {lot.onHand > 0 ? (
                                    <ReturnDialog
                                      productId={stock.productId}
                                      lotId={lot.lotId}
                                      lotName={name}
                                      onHand={lot.onHand}
                                    />
                                  ) : null}
                                  {canQuarantine && lot.quarantine ? (
                                    <ReleaseLotButton
                                      productId={stock.productId}
                                      lotId={lot.lotId}
                                    />
                                  ) : null}
                                  {canQuarantine &&
                                  !lot.quarantine &&
                                  lot.tracking !== "unknown" ? (
                                    <QuarantineDialog
                                      productId={stock.productId}
                                      lotId={lot.lotId}
                                      lotName={name}
                                    />
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section aria-labelledby="reservations-title" className="flex flex-col gap-3">
                <h2 id="reservations-title" className="font-display text-2xl font-semibold">
                  Set aside
                </h2>
                {stock.reservations.length === 0 ? (
                  <EmptyState title="Nothing is set aside" data-testid="reservations-empty" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <caption className="sr-only">Active reservations, newest first</caption>
                      <thead>
                        <tr className="border-b border-[var(--color-border-strong)]">
                          <th scope="col" className="py-2 pr-4 font-semibold">
                            Kind
                          </th>
                          <th
                            scope="col"
                            className="py-2 pr-4 text-right font-semibold tabular-nums"
                          >
                            Quantity
                          </th>
                          <th scope="col" className="py-2 pr-4 font-semibold">
                            Reference
                          </th>
                          <th scope="col" className="py-2 pr-4 font-semibold">
                            Age
                          </th>
                          <th scope="col" className="py-2 pr-4 font-semibold">
                            Expires
                          </th>
                          <th scope="col" className="py-2 font-semibold">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {stock.reservations.map((r) => (
                          <tr key={r.id} className="border-b border-[var(--color-border)]">
                            <td className="py-2 pr-4">{KIND_LABELS[r.kind]}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{r.quantity}</td>
                            <td className="py-2 pr-4">
                              <code>{r.holderRef}</code>
                            </td>
                            <td className="py-2 pr-4 tabular-nums">
                              {formatAge(r.createdAt, now)}
                            </td>
                            <td className="py-2 pr-4">
                              {r.expiresAt ? (
                                formatMoment(r.expiresAt)
                              ) : (
                                <span className="text-[var(--color-text-subtle)]">Never</span>
                              )}
                            </td>
                            <td className="py-2">
                              <ReleaseDialog
                                productId={stock.productId}
                                reservationId={r.id}
                                quantity={r.quantity}
                                kindLabel={KIND_LABELS[r.kind]}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section aria-labelledby="movements-title" className="flex flex-col gap-3">
                <h2 id="movements-title" className="font-display text-2xl font-semibold">
                  Movements
                </h2>
                {stock.movements.length === 0 ? (
                  <EmptyState title="No stock has moved yet" data-testid="movements-empty" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <caption className="sr-only">Stock movements, newest first</caption>
                      <thead>
                        <tr className="border-b border-[var(--color-border-strong)]">
                          <th scope="col" className="py-2 pr-4 font-semibold">
                            When
                          </th>
                          <th
                            scope="col"
                            className="py-2 pr-4 text-right font-semibold tabular-nums"
                          >
                            Change
                          </th>
                          <th scope="col" className="py-2 pr-4 font-semibold">
                            Lot
                          </th>
                          <th scope="col" className="py-2 pr-4 font-semibold">
                            Reason
                          </th>
                          <th scope="col" className="py-2 pr-4 font-semibold">
                            Note
                          </th>
                          <th scope="col" className="py-2 font-semibold">
                            By
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {stock.movements.map((m) => (
                          <tr key={m.id} className="border-b border-[var(--color-border)]">
                            <td className="py-2 pr-4">{formatMoment(m.at)}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">
                              <Badge variant={m.delta > 0 ? "success" : "amber"}>
                                {signed(m.delta)}
                              </Badge>
                            </td>
                            <td className="py-2 pr-4">{lotNames.get(m.lotId) ?? ""}</td>
                            <td className="py-2 pr-4">{REASON_LABELS[m.reason]}</td>
                            <td className="py-2 pr-4">{m.note ?? ""}</td>
                            <td className="py-2">{who(m)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          ) : null}
        </Stack>
      </main>
    </Container>
  );
}
