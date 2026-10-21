import { isDomainError } from "@igs/kernel";
import { type ReconciliationView, getReconciliation } from "@igs/module-inventory";
import { PERMISSIONS, hasPermission } from "@igs/rbac";
import { Alert, Badge, Container, Link, Stack } from "@igs/ui";

import { CountActions } from "../../../../components/count-actions";
import { PageHeader } from "../../../../components/page-header";
import {
  formatDate,
  formatMoment,
  lotLabel,
  stockErrorMessage,
} from "../../../../components/stock-labels";
import { requireStaffActor } from "../../../../server/actor";
import { ensureKernelConfigured } from "../../../../server/kernel";

export const metadata = { title: "Stock count · IGS-Pharma Platform" };

interface Props {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<{ done?: string | string[] }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

const STATUS: Record<ReconciliationView["status"], string> = {
  open: "Preview: nothing has changed yet",
  applied: "Applied",
  discarded: "Discarded",
};

/**
 * One count of the web stock (igs-pharma#166): per lot, what the ledger held when it was counted,
 * the count and the difference. Applying it books exactly those differences; a lot that moved
 * since makes it stale (count again).
 */
export default async function CountPage({ params, searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const { id } = await params;
  const done = first((await searchParams).done);

  let count: ReconciliationView | null = null;
  let error: string | null = null;
  if (!UUID.test(id)) {
    error = "inventory.reconciliation_not_found";
  } else {
    try {
      count = await getReconciliation({ reconciliationId: id }, actor);
    } catch (e) {
      if (!isDomainError(e)) throw e;
      error = e.code;
    }
  }
  if (!count) {
    return (
      <Container asChild size="lg">
        <main className="py-10">
          <Stack gap={6}>
            <Link href="/stock">Back to stock</Link>
            <Alert variant="error" title="You can't see this count">
              {stockErrorMessage(error ?? "kernel.forbidden")}
            </Alert>
          </Stack>
        </main>
      </Container>
    );
  }
  const differing = count.lines.filter((line) => line.difference !== 0).length;
  const moved = count.lines.filter((line) => line.moved).length;
  const canApply =
    count.status === "open" && hasPermission(actor.roles, PERMISSIONS.inventory.stockManage);

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <Link href="/stock">Back to stock</Link>
          <PageHeader
            title="Stock count"
            description={`${count.source === "csv" ? "Count file" : "Typed count"} of ${formatMoment(count.startedAt)}.`}
          />
          {done === "applied" ? (
            <Alert variant="success" title="The count is applied">
              {differing === 0
                ? "Every lot matched: nothing changed."
                : `${differing} lot${differing === 1 ? "" : "s"} changed.`}
            </Alert>
          ) : null}
          {done === "discarded" ? (
            <Alert variant="info" title="The count is discarded">
              Nothing changed.
            </Alert>
          ) : null}
          <p data-testid="count-status">
            <Badge
              variant={
                count.status === "applied"
                  ? "success"
                  : count.status === "discarded"
                    ? "neutral"
                    : "amber"
              }
            >
              {STATUS[count.status]}
            </Badge>
          </p>
          {count.status === "open" ? (
            moved > 0 ? (
              <Alert variant="error" title="Stock moved since this count" data-testid="count-stale">
                {moved} lot{moved === 1 ? "" : "s"} changed after the count was previewed, so it
                can't be applied. Discard it and count again.
              </Alert>
            ) : (
              <Alert variant="info" title="Check the differences">
                {differing === 0
                  ? "Every lot matches the stock: confirming changes nothing."
                  : `${differing} lot${differing === 1 ? "" : "s"} will change when you apply the count.`}
              </Alert>
            )
          ) : null}

          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Counted lots</caption>
            <thead>
              <tr className="border-b border-[var(--color-border-strong)]">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Product
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Lot
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Expires
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-semibold tabular-nums">
                  In stock
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-semibold tabular-nums">
                  Counted
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  Difference
                </th>
              </tr>
            </thead>
            <tbody>
              {count.lines.map((line) => (
                <tr key={line.line} className="border-b border-[var(--color-border)]">
                  <td className="py-2 pr-4">
                    <code>{line.cnk}</code> {line.nameNl ?? ""}
                  </td>
                  <td className="py-2 pr-4">{lotLabel(line)}</td>
                  <td className="py-2 pr-4">
                    {line.expiryDate ? formatDate(line.expiryDate) : "—"}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{line.booked}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{line.counted}</td>
                  <td className="py-2 text-right">
                    {line.moved ? (
                      <Badge variant="error">Moved since</Badge>
                    ) : line.difference === 0 ? (
                      <span className="text-[var(--color-text-subtle)]">No change</span>
                    ) : (
                      <Badge variant={line.difference > 0 ? "success" : "amber"}>
                        {signed(line.difference)}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {canApply ? (
            <CountActions reconciliationId={count.reconciliationId} differing={differing} />
          ) : null}
        </Stack>
      </main>
    </Container>
  );
}
