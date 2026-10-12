import { isDomainError } from "@igs/kernel";
import { type ProductStock, getStock } from "@igs/module-inventory";
import { Alert, Badge, Container, Link, Stack } from "@igs/ui";

import { AdjustDialog } from "../../../components/adjust-dialog";
import { REASON_LABELS, formatMoment, stockErrorMessage } from "../../../components/stock-labels";
import { requireStaffActor } from "../../../server/actor";
import { ensureKernelConfigured } from "../../../server/kernel";

export const metadata = { title: "Stock history · IGS-Pharma Platform" };

interface Props {
  readonly params: Promise<{ productId: string }>;
  readonly searchParams: Promise<{ adjusted?: string | string[] }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** One product's on-hand and movement history, newest first, with the Adjust dialog. */
export default async function ProductStockPage({ params, searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const { productId } = await params;
  const { adjusted } = await searchParams;

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

              <p className="text-2xl">
                On hand: <strong data-testid="on-hand">{stock.onHand}</strong>
              </p>

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
