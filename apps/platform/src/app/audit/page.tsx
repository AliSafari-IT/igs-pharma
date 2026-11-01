import { isDomainError } from "@igs/kernel";
import { type AuditPage, DENIED_ACTION, listAuditEvents } from "@igs/module-audit";
import { type StaffMember, listStaff } from "@igs/module-identity";
import {
  Alert,
  Badge,
  Button,
  Container,
  EmptyState,
  Input,
  Label,
  Link,
  Select,
  Stack,
} from "@igs/ui";

import {
  actorLabel,
  addDays,
  auditHref,
  brusselsDayStart,
  dataValue,
  filtersOf,
} from "../../components/audit-labels";
import { identityErrorMessage } from "../../components/identity-labels";
import { PageHeader } from "../../components/page-header";
import { formatMoment } from "../../components/stock-labels";
import { requestOrigin, requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

export const metadata = { title: "Audit trail · IGS-Pharma Platform" };

const PAGE_SIZE = 50;

interface Props {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The audit trail (igs-pharma#220): who did what and when, newest first, read-only. Filters by action
 * (exact, or a prefix ending in "."), by staff member, by entity id and by Brussels days; "Refused
 * actions only" shows `kernel.access.denied` (who tried what without being allowed). The owner only.
 */
export default async function AuditPageView({ searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const filters = filtersOf(await searchParams, new Date());
  const from = brusselsDayStart(filters.fromDay) as Date;
  const to = brusselsDayStart(addDays(filters.toDay, 1)) as Date;

  let result: AuditPage | null = null;
  let error: string | null = null;
  let staff: readonly StaffMember[] = [];
  try {
    result = await listAuditEvents(
      {
        from,
        to,
        ...(filters.refused
          ? { action: DENIED_ACTION }
          : filters.action
            ? { action: filters.action }
            : {}),
        ...(filters.actorId ? { actorId: filters.actorId } : {}),
        ...(filters.entityId ? { entityId: filters.entityId } : {}),
        page: filters.page,
        pageSize: PAGE_SIZE,
      },
      actor,
      // a refused visit is itself audited (igs-pharma#210), with the hashed origin
      { origin: await requestOrigin() },
    );
    staff = await listStaff({}, actor);
  } catch (e) {
    if (!isDomainError(e)) throw e;
    error = e.code;
  }
  const names = new Map(staff.map((member) => [member.id, member.name]));

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader
            title="Audit trail"
            description="Who did what and when, newest first. The trail is written by the system and cannot be changed. Personal details are never stored in it: only ids, codes and hashes."
          />

          {error ? (
            <Alert variant="error" title="You can't see the audit trail">
              {error === "kernel.validation_failed"
                ? "Those filters are not valid. Pick at most a year, and an action like identity.early_access.approved or a prefix ending in a dot."
                : identityErrorMessage(error)}
            </Alert>
          ) : null}

          <search>
            <form method="get" action="/audit" className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="audit-from">From</Label>
                <Input id="audit-from" name="from" type="date" defaultValue={filters.fromDay} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="audit-to">To</Label>
                <Input id="audit-to" name="to" type="date" defaultValue={filters.toDay} />
              </div>
              <div className="flex min-w-56 flex-col gap-1.5">
                <Label htmlFor="audit-action">Action</Label>
                <Input
                  id="audit-action"
                  name="action"
                  defaultValue={filters.refused ? "" : (filters.action ?? "")}
                  placeholder="e.g. identity.early_access."
                  autoComplete="off"
                />
              </div>
              <div className="flex min-w-48 flex-col gap-1.5">
                <Label htmlFor="audit-actor">Who</Label>
                <Select id="audit-actor" name="actor" defaultValue={filters.actorId ?? ""}>
                  <option value="">Anyone</option>
                  {staff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex min-w-48 flex-col gap-1.5">
                <Label htmlFor="audit-entity">Entity id</Label>
                <Input
                  id="audit-entity"
                  name="entity"
                  defaultValue={filters.entityId ?? ""}
                  autoComplete="off"
                />
              </div>
              <label className="flex items-center gap-2 pb-2">
                <input
                  type="checkbox"
                  name="refused"
                  value="1"
                  defaultChecked={filters.refused}
                  data-testid="audit-refused"
                />
                <span>Refused actions only</span>
              </label>
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>
          </search>

          {result ? (
            result.items.length === 0 ? (
              <EmptyState
                title="Nothing in the trail matches these filters"
                data-testid="audit-empty"
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left" data-testid="audit-table">
                    <caption className="sr-only">
                      Audit trail from {filters.fromDay} to {filters.toDay}, page {result.page}
                    </caption>
                    <thead>
                      <tr className="border-b border-[var(--color-border-strong)]">
                        <th scope="col" className="py-2 pr-4 font-semibold">
                          When
                        </th>
                        <th scope="col" className="py-2 pr-4 font-semibold">
                          Who
                        </th>
                        <th scope="col" className="py-2 pr-4 font-semibold">
                          Action
                        </th>
                        <th scope="col" className="py-2 font-semibold">
                          Details
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((item) => (
                        <tr
                          key={item.seq}
                          className="border-b border-[var(--color-border)] align-top"
                        >
                          <td className="py-2 pr-4 whitespace-nowrap">{formatMoment(item.at)}</td>
                          <td className="py-2 pr-4">
                            {actorLabel(item.actorType, item.actorId, names)}
                            {item.hasOrigin ? (
                              <span className="block text-xs text-[var(--color-text-subtle)]">
                                address recorded as a hash
                              </span>
                            ) : null}
                          </td>
                          <td className="py-2 pr-4">
                            <span className="font-mono text-sm break-all">{item.action}</span>
                            {item.action === DENIED_ACTION ? (
                              <Badge variant="error" className="ml-2">
                                Refused
                              </Badge>
                            ) : null}
                            {item.entityId ? (
                              <span className="block text-xs break-all text-[var(--color-text-subtle)]">
                                {item.entityType}: {item.entityId}
                              </span>
                            ) : null}
                          </td>
                          <td className="py-2 text-sm">
                            <dl className="grid grid-cols-[auto_1fr] gap-x-2">
                              {Object.entries(item.data).map(([key, value]) => (
                                <div key={key} className="contents">
                                  <dt className="text-[var(--color-text-subtle)]">{key}</dt>
                                  <dd className="font-mono break-all">{dataValue(value)}</dd>
                                </div>
                              ))}
                            </dl>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <nav aria-label="Pages" className="flex gap-4">
                  {result.page > 1 ? (
                    <Link href={auditHref(filters, result.page - 1)}>Newer</Link>
                  ) : null}
                  {result.hasMore ? (
                    <Link href={auditHref(filters, result.page + 1)}>Older</Link>
                  ) : null}
                </nav>
              </>
            )
          ) : null}
        </Stack>
      </main>
    </Container>
  );
}
