import { isDomainError } from "@igs/kernel";
import { type RecallListItem, listRecalls } from "@igs/module-inventory";
import { Alert, Badge, Container, EmptyState, Link, Stack } from "@igs/ui";

import { PageHeader } from "../../components/page-header";
import {
  RECALL_SCOPE_LABELS,
  RECALL_SOURCE_LABELS,
  formatMoment,
  stockErrorMessage,
} from "../../components/stock-labels";
import { requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

export const metadata = { title: "Recalls · IGS-Pharma Platform" };

/**
 * Recalls (igs-pharma#187, REQ-SAF-01): the active ones first, then the latest ended. A pharmacist
 * starts one from a product's stock page and ends it from the recall's page.
 */
export default async function RecallsPage() {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  let recalls: readonly RecallListItem[] = [];
  let error: string | null = null;
  try {
    recalls = await listRecalls({}, actor);
  } catch (e) {
    if (!isDomainError(e)) throw e;
    error = e.code;
  }

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader
            title="Recalls"
            description="A recall quarantines a product's lots and stops it selling until a pharmacist ends it. Start one from the product's stock page."
          />
          {error ? (
            <Alert variant="error" title="You can't see the recalls">
              {stockErrorMessage(error)}
            </Alert>
          ) : recalls.length === 0 ? (
            <EmptyState title="No recalls yet" data-testid="recalls-empty" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left" data-testid="recalls">
                <caption className="sr-only">Recalls, active first</caption>
                <thead>
                  <tr className="border-b border-[var(--color-border-strong)]">
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Product
                    </th>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Called by
                    </th>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Lots
                    </th>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Started
                    </th>
                    <th scope="col" className="py-2 font-semibold">
                      State
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recalls.map((recall) => (
                    <tr key={recall.recallId} className="border-b border-[var(--color-border)]">
                      <td className="py-2 pr-4">
                        <Link href={`/recalls/${recall.recallId}`}>
                          {recall.nameNl ?? "No Dutch name yet"}
                        </Link>{" "}
                        <code className="text-sm">{recall.cnk}</code>
                      </td>
                      <td className="py-2 pr-4">{RECALL_SOURCE_LABELS[recall.source]}</td>
                      <td className="py-2 pr-4">
                        {RECALL_SCOPE_LABELS[recall.scope]} ({recall.lotCount})
                      </td>
                      <td className="py-2 pr-4">{formatMoment(recall.startedAt)}</td>
                      <td className="py-2">
                        {recall.endedAt ? (
                          <Badge variant="neutral">Ended {formatMoment(recall.endedAt)}</Badge>
                        ) : (
                          <Badge variant="error">Active: not selling</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Stack>
      </main>
    </Container>
  );
}
