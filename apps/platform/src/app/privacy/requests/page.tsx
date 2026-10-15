import { isDomainError } from "@igs/kernel";
import { DSR_STATUSES, DSR_TYPES, type DsrPage, listDsr } from "@igs/module-privacy";
import { Alert, Badge, Button, Container, Label, Link, Select, Stack } from "@igs/ui";

import { PageHeader } from "../../../components/page-header";
import {
  DSR_STATUS_BADGE,
  DSR_STATUS_LABELS,
  DSR_TYPE_LABELS,
  dueLabel,
  formatDay,
  privacyErrorMessage,
} from "../../../components/privacy-labels";
import { requireStaffActor } from "../../../server/actor";
import { ensureKernelConfigured } from "../../../server/kernel";

export const metadata = { title: "Data requests · IGS-Pharma Platform" };

const PAGE_SIZE = 25;

interface Props {
  readonly searchParams: Promise<{
    status?: string | string[];
    type?: string | string[];
    page?: string | string[];
  }>;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const oneOf = <T extends string>(values: readonly T[], value: string | undefined): T | undefined =>
  values.find((v) => v === value);

/**
 * The register of data-subject requests (igs-pharma#58): open ones first, the closest deadline on
 * top, overdue ones marked in red.
 */
export default async function DataRequestsPage({ searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const params = await searchParams;
  const status = oneOf(DSR_STATUSES, first(params.status));
  const type = oneOf(DSR_TYPES, first(params.type));
  const page = Math.max(1, Math.min(10_000, Number.parseInt(first(params.page) ?? "1", 10) || 1));

  let result: DsrPage | null = null;
  let error: string | null = null;
  try {
    result = await listDsr(
      { ...(status ? { status } : {}), ...(type ? { type } : {}), page, pageSize: PAGE_SIZE },
      actor,
    );
  } catch (e) {
    if (!isDomainError(e)) throw e;
    error = e.code;
  }
  const pages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const pageHref = (n: number) =>
    `/privacy/requests?${new URLSearchParams({
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      page: String(n),
    })}`;

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader
            title="Data requests"
            description={
              <>
                Requests from people about their personal data (GDPR). Each one must be answered
                within one month of receipt. <Link href="/privacy/consents">Consents</Link>
              </>
            }
            action={
              result ? (
                <Button asChild>
                  <a href="/privacy/requests/new">New request</a>
                </Button>
              ) : null
            }
          />

          {error ? (
            <Alert variant="error" title="You can't see the data requests">
              {privacyErrorMessage(error)}
            </Alert>
          ) : null}

          {result && result.overdueTotal > 0 ? (
            <Alert variant="error" title="Overdue requests">
              {result.overdueTotal} open request{result.overdueTotal === 1 ? " is" : "s are"} past
              the one-month deadline.
            </Alert>
          ) : null}

          {result ? (
            <>
              <search>
                <form
                  method="get"
                  action="/privacy/requests"
                  className="flex flex-wrap items-end gap-3"
                >
                  <div className="flex min-w-48 flex-col gap-1.5">
                    <Label htmlFor="dsr-status">Status</Label>
                    <Select id="dsr-status" name="status" defaultValue={status ?? ""}>
                      <option value="">All statuses</option>
                      {DSR_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {DSR_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex min-w-48 flex-col gap-1.5">
                    <Label htmlFor="dsr-type">Type</Label>
                    <Select id="dsr-type" name="type" defaultValue={type ?? ""}>
                      <option value="">All types</option>
                      {DSR_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {DSR_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button type="submit" variant="secondary">
                    Filter
                  </Button>
                </form>
              </search>

              {result.items.length === 0 ? (
                <p className="text-[var(--color-text-subtle)]">
                  {status || type ? "No requests match these filters." : "No requests yet."}
                </p>
              ) : (
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">
                    Data requests, page {result.page} of {pages}
                  </caption>
                  <thead>
                    <tr className="border-b border-[var(--color-border-strong)]">
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Type
                      </th>
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Person
                      </th>
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Received
                      </th>
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Deadline
                      </th>
                      <th scope="col" className="py-2 font-semibold">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((item) => (
                      <tr key={item.id} className="border-b border-[var(--color-border)]">
                        <td className="py-2 pr-4">
                          <Link href={`/privacy/requests/${item.id}`}>
                            {DSR_TYPE_LABELS[item.type]}
                          </Link>
                        </td>
                        <td className="py-2 pr-4 break-all">{item.subjectRef}</td>
                        <td className="py-2 pr-4">{formatDay(item.receivedAt)}</td>
                        <td className="py-2 pr-4">
                          {item.overdue ? (
                            <Badge variant="error">Overdue</Badge>
                          ) : item.daysLeft !== null ? (
                            dueLabel(item.daysLeft)
                          ) : (
                            <span className="text-[var(--color-text-subtle)]">Closed</span>
                          )}
                          {item.overdue && item.daysLeft !== null ? (
                            <span className="ml-2 text-sm">{dueLabel(item.daysLeft)}</span>
                          ) : null}
                          {item.extension ? (
                            <Badge variant="primary" className="ml-2">
                              Extended
                            </Badge>
                          ) : null}
                        </td>
                        <td className="py-2">
                          <Badge variant={DSR_STATUS_BADGE[item.status]}>
                            {DSR_STATUS_LABELS[item.status]}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <nav aria-label="Pages" className="flex items-center gap-4">
                {result.page > 1 ? (
                  <Link href={pageHref(result.page - 1)}>Previous page</Link>
                ) : null}
                <span className="text-sm text-[var(--color-text-subtle)]">
                  Page {result.page} of {pages} · {result.total} request
                  {result.total === 1 ? "" : "s"}
                </span>
                {result.page < pages ? (
                  <Link href={pageHref(result.page + 1)}>Next page</Link>
                ) : null}
              </nav>
            </>
          ) : null}
        </Stack>
      </main>
    </Container>
  );
}
