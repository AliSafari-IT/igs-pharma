import { isDomainError } from "@igs/kernel";
import { type ProductStock, getStock } from "@igs/module-inventory";
import { PERMISSIONS, hasPermission } from "@igs/rbac";
import { Alert, Badge, Container, EmptyState, Link, Stack } from "@igs/ui";
import {
  ResponsiveTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/responsive-table";

import { AdjustDialog } from "../../../components/adjust-dialog";
import {
  AssignLotDialog,
  CountLotsDialog,
  QuarantineDialog,
  ReceiveDialog,
  ReleaseLotButton,
  ReturnDialog,
} from "../../../components/lot-dialogs";
import { PageHeader } from "../../../components/page-header";
import { StartRecallDialog } from "../../../components/recall-dialogs";
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
  const canRecall = hasPermission(actor.roles, PERMISSIONS.inventory.recallsManage);
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
      <main className="py-10 [overflow-wrap:anywhere]">
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
                  {stock.lots.length > 0 ? (
                    <CountLotsDialog
                      productId={stock.productId}
                      lots={stock.lots.map((lot) => ({
                        lotId: lot.lotId,
                        label: `${lotLabel(lot)}${lot.expiryDate ? ` · exp. ${formatDate(lot.expiryDate)}` : ""}`,
                        onHand: lot.onHand,
                      }))}
                    />
                  ) : null}
                  {canRecall && !stock.activeRecallId ? (
                    <StartRecallDialog
                      productId={stock.productId}
                      lots={stock.lots.map((lot) => ({
                        lotId: lot.lotId,
                        label: `${lotLabel(lot)}${lot.expiryDate ? ` · exp. ${formatDate(lot.expiryDate)}` : ""} · ${lot.onHand} on hand`,
                      }))}
                    />
                  ) : null}
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
              {stock.activeRecallId ? (
                <Alert
                  variant="error"
                  title="Recalled: this product is not selling"
                  data-testid="recalled"
                >
                  Its recalled lots are in quarantine and it is off the webshop.{" "}
                  <Link href={`/recalls/${stock.activeRecallId}`}>See the recall</Link>
                </Alert>
              ) : null}

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
                  <ResponsiveTable data-testid="lots">
                    <caption className="sr-only">Lots, earliest expiry first</caption>
                    <TableHead>
                      <TableRow className="border-b border-[var(--color-border-strong)]">
                        <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                          Lot
                        </TableHeader>
                        <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                          Expires
                        </TableHeader>
                        <TableHeader
                          scope="col"
                          className="py-2 pr-4 text-right font-semibold tabular-nums"
                        >
                          On hand
                        </TableHeader>
                        <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                          State
                        </TableHeader>
                        <TableHeader scope="col" className="py-2 font-semibold">
                          <span className="sr-only">Actions</span>
                        </TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {stock.lots.map((lot) => {
                        const state = lotState(lot);
                        const name = lotLabel(lot);
                        return (
                          <TableRow
                            key={lot.lotId}
                            className="border-b border-[var(--color-border)]"
                          >
                            <TableCell label="Lot" className="py-2 pr-4">
                              {lot.tracking === "lot" ? <code>{name}</code> : name}
                            </TableCell>
                            <TableCell label="Expires" className="py-2 pr-4">
                              {lot.expiryDate ? formatDate(lot.expiryDate) : "—"}
                            </TableCell>
                            <TableCell
                              label="On hand"
                              className="py-2 pr-4 text-right tabular-nums"
                            >
                              {lot.onHand}
                            </TableCell>
                            <TableCell label="State" className="py-2 pr-4">
                              <Badge variant={state.variant}>{state.label}</Badge>
                            </TableCell>
                            <TableCell label="Actions" stacked className="py-2">
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
                                  <ReleaseLotButton productId={stock.productId} lotId={lot.lotId} />
                                ) : null}
                                {canQuarantine && !lot.quarantine && lot.tracking !== "unknown" ? (
                                  <QuarantineDialog
                                    productId={stock.productId}
                                    lotId={lot.lotId}
                                    lotName={name}
                                  />
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </ResponsiveTable>
                )}
              </section>

              <section aria-labelledby="reservations-title" className="flex flex-col gap-3">
                <h2 id="reservations-title" className="font-display text-2xl font-semibold">
                  Set aside
                </h2>
                {stock.reservations.length === 0 ? (
                  <EmptyState title="Nothing is set aside" data-testid="reservations-empty" />
                ) : (
                  <ResponsiveTable>
                    <caption className="sr-only">Active reservations, newest first</caption>
                    <TableHead>
                      <TableRow className="border-b border-[var(--color-border-strong)]">
                        <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                          Kind
                        </TableHeader>
                        <TableHeader
                          scope="col"
                          className="py-2 pr-4 text-right font-semibold tabular-nums"
                        >
                          Quantity
                        </TableHeader>
                        <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                          Reference
                        </TableHeader>
                        <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                          Age
                        </TableHeader>
                        <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                          Expires
                        </TableHeader>
                        <TableHeader scope="col" className="py-2 font-semibold">
                          <span className="sr-only">Actions</span>
                        </TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {stock.reservations.map((r) => (
                        <TableRow key={r.id} className="border-b border-[var(--color-border)]">
                          <TableCell label="Kind" className="py-2 pr-4">
                            {KIND_LABELS[r.kind]}
                          </TableCell>
                          <TableCell label="Quantity" className="py-2 pr-4 text-right tabular-nums">
                            {r.quantity}
                          </TableCell>
                          <TableCell label="Reference" className="py-2 pr-4">
                            <code>{r.holderRef}</code>
                          </TableCell>
                          <TableCell label="Age" className="py-2 pr-4 tabular-nums">
                            {formatAge(r.createdAt, now)}
                          </TableCell>
                          <TableCell label="Expires" className="py-2 pr-4">
                            {r.expiresAt ? (
                              formatMoment(r.expiresAt)
                            ) : (
                              <span className="text-[var(--color-text-subtle)]">Never</span>
                            )}
                          </TableCell>
                          <TableCell label="Actions" stacked className="py-2">
                            <ReleaseDialog
                              productId={stock.productId}
                              reservationId={r.id}
                              quantity={r.quantity}
                              kindLabel={KIND_LABELS[r.kind]}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </ResponsiveTable>
                )}
              </section>

              <section aria-labelledby="movements-title" className="flex flex-col gap-3">
                <h2 id="movements-title" className="font-display text-2xl font-semibold">
                  Movements
                </h2>
                {stock.movements.length === 0 ? (
                  <EmptyState title="No stock has moved yet" data-testid="movements-empty" />
                ) : (
                  <ResponsiveTable>
                    <caption className="sr-only">Stock movements, newest first</caption>
                    <TableHead>
                      <TableRow className="border-b border-[var(--color-border-strong)]">
                        <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                          When
                        </TableHeader>
                        <TableHeader
                          scope="col"
                          className="py-2 pr-4 text-right font-semibold tabular-nums"
                        >
                          Change
                        </TableHeader>
                        <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                          Lot
                        </TableHeader>
                        <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                          Reason
                        </TableHeader>
                        <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                          Note
                        </TableHeader>
                        <TableHeader scope="col" className="py-2 font-semibold">
                          By
                        </TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {stock.movements.map((m) => (
                        <TableRow key={m.id} className="border-b border-[var(--color-border)]">
                          <TableCell label="When" className="py-2 pr-4">
                            {formatMoment(m.at)}
                          </TableCell>
                          <TableCell label="Change" className="py-2 pr-4 text-right tabular-nums">
                            <Badge variant={m.delta > 0 ? "success" : "amber"}>
                              {signed(m.delta)}
                            </Badge>
                          </TableCell>
                          <TableCell label="Lot" className="py-2 pr-4">
                            {lotNames.get(m.lotId) ?? ""}
                          </TableCell>
                          <TableCell label="Reason" className="py-2 pr-4">
                            {REASON_LABELS[m.reason]}
                          </TableCell>
                          <TableCell label="Note" className="py-2 pr-4">
                            {m.note ?? ""}
                          </TableCell>
                          <TableCell label="By" className="py-2">
                            {who(m)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </ResponsiveTable>
                )}
              </section>
            </>
          ) : null}
        </Stack>
      </main>
    </Container>
  );
}
