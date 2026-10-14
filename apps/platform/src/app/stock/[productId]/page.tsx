import { isDomainError } from "@igs/kernel";
import { type ProductStock, getStock } from "@igs/module-inventory";
import { Alert, Badge, Container, Link, Stack } from "@igs/ui";

import { AdjustDialog } from "../../../components/adjust-dialog";
import { ReleaseDialog } from "../../../components/release-dialog";
import {
  KIND_LABELS,
  REASON_LABELS,
  formatAge,
  formatMoment,
  stockErrorMessage,
} from "../../../components/stock-labels";
import { requireStaffActor } from "../../../server/actor";
import { ensureKernelConfigured } from "../../../server/kernel";

export const metadata = { title: "Stock history · IGS-Pharma Platform" };

interface Props {
  readonly params: Promise<{ productId: string }>;
  readonly searchParams: Promise<{ adjusted?: string | string[]; released?: string | string[] }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** One product's on-hand and movement history, newest first, with the Adjust dialog. */
export default async function ProductStockPage({ params, searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const { productId } = await params;
  const { adjusted, released } = await searchParams;
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
          <Link href="/stock">Back to stock</Link>

          {error ? (
            <Alert variant="error" title="You can't see this product's stock">
              {stockErrorMessage(error)}
            </Alert>
          ) : null}

          {stock ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="font-display text-4xl font-medium text-[var(--color-primary)]">
                    {stock.nameNl ?? "No Dutch name yet"}
                  </h1>
                  <p className="text-[var(--color-text-subtle)]">
                    CNK <code>{stock.cnk}</code> · Saint-Gilles pharmacy
                  </p>
                </div>
                <AdjustDialog productId={stock.productId} onHand={stock.onHand} />
              </div>

              {first(adjusted) === "1" ? (
                <Alert variant="success" title="Stock changed">
                  On hand is now {stock.onHand}.
                </Alert>
              ) : null}

              {first(released) === "1" ? (
                <Alert variant="success" title="Stock released">
                  The reservation ended and its stock is available again.
                </Alert>
              ) : null}

              {stock.short > 0 ? (
                <Alert variant="error" title={`Short by ${stock.short}`}>
                  The orders set aside {stock.ordered} but only {stock.onHand} are on hand. Count
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
                  <dt>Available</dt>
                  <dd data-testid="available">{stock.available}</dd>
                </div>
              </dl>

              <section aria-labelledby="reservations-title" className="flex flex-col gap-3">
                <h2 id="reservations-title" className="font-display text-2xl font-semibold">
                  Set aside
                </h2>
                {stock.reservations.length === 0 ? (
                  <p className="text-[var(--color-text-subtle)]">Nothing is set aside.</p>
                ) : (
                  <table className="w-full border-collapse text-left">
                    <caption className="sr-only">Active reservations, newest first</caption>
                    <thead>
                      <tr className="border-b border-[var(--color-border-strong)]">
                        <th scope="col" className="py-2 pr-4 font-semibold">
                          Kind
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right font-semibold">
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
                          <td className="py-2 pr-4 text-right">{r.quantity}</td>
                          <td className="py-2 pr-4">
                            <code>{r.holderRef}</code>
                          </td>
                          <td className="py-2 pr-4">{formatAge(r.createdAt, now)}</td>
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
                )}
              </section>

              <h2 className="font-display text-2xl font-semibold">Movements</h2>
              {stock.movements.length === 0 ? (
                <p className="text-[var(--color-text-subtle)]">No stock has moved yet.</p>
              ) : (
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">Stock movements, newest first</caption>
                  <thead>
                    <tr className="border-b border-[var(--color-border-strong)]">
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        When
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-semibold">
                        Change
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
                        <td className="py-2 pr-4 text-right">
                          <Badge variant={m.delta > 0 ? "success" : "amber"}>
                            {signed(m.delta)}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4">{REASON_LABELS[m.reason]}</td>
                        <td className="py-2 pr-4">{m.note ?? ""}</td>
                        <td className="py-2">{who(m)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : null}
        </Stack>
      </main>
    </Container>
  );
}
