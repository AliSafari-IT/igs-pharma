import { isDomainError } from "@igs/kernel";
import { type RecallView, getRecall } from "@igs/module-inventory";
import { PERMISSIONS, hasPermission } from "@igs/rbac";
import { Alert, Badge, Container, Link, Stack } from "@igs/ui";

import { PageHeader } from "../../../components/page-header";
import { EndRecallDialog } from "../../../components/recall-dialogs";
import {
  RECALL_SCOPE_LABELS,
  RECALL_SOURCE_LABELS,
  formatDate,
  formatMoment,
  lotLabel,
  lotState,
  stockErrorMessage,
} from "../../../components/stock-labels";
import { requireStaffActor } from "../../../server/actor";
import { ensureKernelConfigured } from "../../../server/kernel";

export const metadata = { title: "Recall · IGS-Pharma Platform" };

interface Props {
  readonly params: Promise<{ recallId: string }>;
  readonly searchParams: Promise<{ done?: string | string[] }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const DONE: Record<string, string> = {
  started: "The recall started: its lots are in quarantine and the product has stopped selling.",
  ended: "The recall ended: the product may sell again. Its lots stay in quarantine.",
};

/** One recall (igs-pharma#187): what it covers, who called it, its lots as they stand now. */
export default async function RecallPage({ params, searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const { recallId } = await params;
  const doneText = DONE[first((await searchParams).done) ?? ""];

  let recall: RecallView | null = null;
  let error: string | null = null;
  if (!UUID.test(recallId)) {
    error = "inventory.recall_not_found";
  } else {
    try {
      recall = await getRecall({ recallId }, actor);
    } catch (e) {
      if (!isDomainError(e)) throw e;
      error = e.code;
    }
  }
  if (!recall) {
    return (
      <Container asChild size="lg">
        <main className="py-10">
          <Stack gap={6}>
            <Link href="/recalls">Back to recalls</Link>
            <Alert variant="error" title="You can't see this recall">
              {stockErrorMessage(error ?? "kernel.forbidden")}
            </Alert>
          </Stack>
        </main>
      </Container>
    );
  }
  const canEnd =
    recall.endedAt === null && hasPermission(actor.roles, PERMISSIONS.inventory.recallsManage);
  const who = (id: string | null) => (id === actor.id ? "you" : "a pharmacist");

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader
            title={`Recall: ${recall.nameNl ?? "No Dutch name yet"}`}
            back={{ href: "/recalls", label: "Back to recalls" }}
            description={
              <>
                CNK <code>{recall.cnk}</code> ·{" "}
                <Link href={`/stock/${recall.productId}`}>Stock of this product</Link>
              </>
            }
            action={canEnd ? <EndRecallDialog recallId={recall.recallId} /> : undefined}
          />

          {doneText ? (
            <Alert variant="success" title="Saved">
              {doneText}
            </Alert>
          ) : null}

          {recall.endedAt ? (
            <Alert variant="info" title="This recall has ended">
              Ended {formatMoment(recall.endedAt)} by {who(recall.endedById)}. The product may sell
              again; its recalled lots stay in quarantine until a pharmacist releases them.
            </Alert>
          ) : (
            <Alert
              variant="error"
              title="Active: the product is not selling"
              data-testid="recall-active"
            >
              It is off the webshop, and orders holding it can't be paid, approved or packed.
            </Alert>
          )}

          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-[max-content_1fr]">
            <dt className="font-semibold">Called by</dt>
            <dd>{RECALL_SOURCE_LABELS[recall.source]}</dd>
            <dt className="font-semibold">Reference and reason</dt>
            <dd className="whitespace-pre-wrap" data-testid="recall-note">
              {recall.note}
            </dd>
            <dt className="font-semibold">Lots</dt>
            <dd>
              {RECALL_SCOPE_LABELS[recall.scope]} ({recall.lotCount})
            </dd>
            <dt className="font-semibold">Started</dt>
            <dd>
              {formatMoment(recall.startedAt)} by {who(recall.startedById)}
            </dd>
          </dl>

          <section aria-labelledby="recall-lots-title" className="flex flex-col gap-3">
            <h2 id="recall-lots-title" className="font-display text-2xl font-semibold">
              Recalled lots
            </h2>
            {recall.lots.length === 0 ? (
              <p className="text-[var(--color-text-subtle)]">
                The product had no lots when the recall started.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left" data-testid="recall-lots">
                  <caption className="sr-only">The lots this recall covers</caption>
                  <thead>
                    <tr className="border-b border-[var(--color-border-strong)]">
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Lot
                      </th>
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Expires
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-semibold tabular-nums">
                        On hand
                      </th>
                      <th scope="col" className="py-2 font-semibold">
                        State
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recall.lots.map((lot) => {
                      const state = lotState(lot);
                      return (
                        <tr key={lot.lotId} className="border-b border-[var(--color-border)]">
                          <td className="py-2 pr-4">
                            <code>{lotLabel(lot)}</code>
                          </td>
                          <td className="py-2 pr-4">
                            {lot.expiryDate ? formatDate(lot.expiryDate) : "—"}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">{lot.onHand}</td>
                          <td className="py-2">
                            <Badge variant={state.variant}>{state.label}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </Stack>
      </main>
    </Container>
  );
}
