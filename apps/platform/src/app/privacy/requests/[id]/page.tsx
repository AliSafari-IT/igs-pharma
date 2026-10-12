import { isDomainError } from "@igs/kernel";
import { DSR_STATUSES, type DsrView, getDsr } from "@igs/module-privacy";
import { Alert, Badge, Container, Link, Stack } from "@igs/ui";

import { DsrStatusDialog } from "../../../../components/dsr-status-dialog";
import {
  DSR_CHANNEL_LABELS,
  DSR_STATUS_BADGE,
  DSR_STATUS_LABELS,
  DSR_TYPE_LABELS,
  dueLabel,
  formatDay,
  formatMoment,
  privacyErrorMessage,
} from "../../../../components/privacy-labels";
import { requireStaffActor } from "../../../../server/actor";
import { ensureKernelConfigured } from "../../../../server/kernel";

export const metadata = { title: "Data request · IGS-Pharma Platform" };

interface Props {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<{ created?: string | string[]; moved?: string | string[] }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** One data-subject request: its deadline, its timeline and the Change status dialog. */
export default async function DataRequestPage({ params, searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const { id } = await params;
  const flash = await searchParams;
  const moved = DSR_STATUSES.find((s) => s === first(flash.moved));

  let request: DsrView | null = null;
  let error: string | null = null;
  if (!UUID.test(id)) {
    error = "privacy.dsr_not_found";
  } else {
    try {
      request = await getDsr({ requestId: id }, actor);
    } catch (e) {
      if (!isDomainError(e)) throw e;
      error = e.code;
    }
  }
  const who = (event: DsrView["events"][number]) =>
    event.actorType === "user"
      ? event.actorId === actor.id
        ? "You"
        : "Staff member"
      : event.actorId === "seed-catalog"
        ? "Demo data"
        : "System";

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <Link href="/privacy/requests">Back to data requests</Link>

          {error ? (
            <Alert variant="error" title="You can't see this request">
              {privacyErrorMessage(error)}
            </Alert>
          ) : null}

          {request ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="font-display text-4xl font-medium text-[var(--color-primary)]">
                    {DSR_TYPE_LABELS[request.type]} request
                  </h1>
                  <p className="break-all text-[var(--color-text-subtle)]">{request.subjectRef}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={DSR_STATUS_BADGE[request.status]}>
                    {DSR_STATUS_LABELS[request.status]}
                  </Badge>
                  {request.overdue ? <Badge variant="error">Overdue</Badge> : null}
                  {request.nextStatuses.length > 0 ? (
                    <DsrStatusDialog requestId={request.id} nextStatuses={request.nextStatuses} />
                  ) : null}
                </div>
              </div>

              {first(flash.created) === "1" ? (
                <Alert variant="success" title="Request logged">
                  The answer is due on {formatDay(request.dueAt)}.
                </Alert>
              ) : null}
              {moved ? (
                <Alert
                  variant="success"
                  title={`Status changed to ${DSR_STATUS_LABELS[moved].toLowerCase()}`}
                />
              ) : null}

              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
                <dt className="font-semibold">Received</dt>
                <dd>
                  {formatDay(request.receivedAt)} · {DSR_CHANNEL_LABELS[request.channel]}
                </dd>
                <dt className="font-semibold">Answer due</dt>
                <dd>
                  {formatDay(request.dueAt)}
                  {request.daysLeft !== null ? ` · ${dueLabel(request.daysLeft)}` : null}
                </dd>
                {request.closedAt ? (
                  <>
                    <dt className="font-semibold">Closed</dt>
                    <dd>
                      {formatMoment(request.closedAt)}
                      {request.closedReason ? ` · ${request.closedReason}` : null}
                    </dd>
                  </>
                ) : null}
                {request.note ? (
                  <>
                    <dt className="font-semibold">Note</dt>
                    <dd className="whitespace-pre-line">{request.note}</dd>
                  </>
                ) : null}
              </dl>

              <section aria-labelledby="timeline-heading" className="flex flex-col gap-3">
                <h2 id="timeline-heading" className="font-display text-xl font-semibold">
                  Timeline
                </h2>
                <ol className="flex flex-col gap-3 border-l-2 border-[var(--color-border-strong)] pl-4">
                  {request.events.map((event) => (
                    <li key={event.id}>
                      <p>
                        <span className="font-semibold">
                          {event.fromStatus
                            ? `${DSR_STATUS_LABELS[event.fromStatus]} → ${DSR_STATUS_LABELS[event.toStatus]}`
                            : "Request logged"}
                        </span>{" "}
                        <span className="text-sm text-[var(--color-text-subtle)]">
                          {formatMoment(event.at)} · {who(event)}
                        </span>
                      </p>
                      {event.note ? <p className="whitespace-pre-line">{event.note}</p> : null}
                    </li>
                  ))}
                </ol>
              </section>
            </>
          ) : null}
        </Stack>
      </main>
    </Container>
  );
}
