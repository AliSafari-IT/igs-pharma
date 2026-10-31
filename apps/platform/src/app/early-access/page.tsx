import { isDomainError } from "@igs/kernel";
import {
  type EarlyAccessList,
  type EarlyAccessListItem,
  listEarlyAccessRequests,
} from "@igs/module-identity";
import { Alert, Badge, Container, EmptyState, Stack } from "@igs/ui";

import { EarlyAccessDialog } from "../../components/early-access-dialog";
import { identityErrorMessage } from "../../components/identity-labels";
import { PageHeader } from "../../components/page-header";
import { formatMoment } from "../../components/stock-labels";
import { requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

export const metadata = { title: "Early access · IGS-Pharma Platform" };

const who = (item: EarlyAccessListItem) => item.name ?? item.email ?? "this person";

const endsAt = (item: EarlyAccessListItem) =>
  item.expiresAt ? formatMoment(item.expiresAt) : "When the shop opens to everyone";

function Person({ item }: { readonly item: EarlyAccessListItem }) {
  return (
    <td className="py-2 pr-4">
      {item.name ?? "No name"}
      <br />
      <span className="text-sm">
        {item.email ?? "No e-mail"}
        {item.emailVerified ? "" : " (not verified)"}
      </span>
    </td>
  );
}

/**
 * Early access (igs-pharma#199): who asked to see the shop before the launch, who has access now
 * and how it ended for the rest. Only an owner decides, and never on their own request.
 */
export default async function EarlyAccessPage() {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  let list: EarlyAccessList | null = null;
  let error: string | null = null;
  try {
    list = await listEarlyAccessRequests({}, actor);
  } catch (e) {
    if (!isDomainError(e)) throw e;
    error = e.code;
  }
  // nobody decides their own request: the kernel refuses it, so the page doesn't offer it
  const decidable = (item: EarlyAccessListItem) => item.userId !== actor.id;

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={8}>
          <PageHeader
            title="Early access"
            description="Customers who asked to see the shop before the launch. Ending access takes effect within 15 minutes: a pass already issued keeps working until it runs out."
          />
          {error || !list ? (
            <Alert variant="error" title="You can't see the early-access requests">
              {identityErrorMessage(error ?? undefined)}
            </Alert>
          ) : (
            <>
              <Stack gap={3} asChild>
                <section aria-labelledby="ea-pending">
                  <h2 id="ea-pending" className="font-display text-2xl font-semibold">
                    Waiting for a decision ({list.pending.length})
                  </h2>
                  {list.pending.length === 0 ? (
                    <EmptyState
                      title="No one is waiting"
                      data-testid="early-access-pending-empty"
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <table
                        className="w-full border-collapse text-left"
                        data-testid="early-access-pending"
                      >
                        <caption className="sr-only">Requests waiting, oldest first</caption>
                        <thead>
                          <tr className="border-b border-[var(--color-border-strong)]">
                            <th scope="col" className="py-2 pr-4 font-semibold">
                              Who
                            </th>
                            <th scope="col" className="py-2 pr-4 font-semibold">
                              Note
                            </th>
                            <th scope="col" className="py-2 pr-4 font-semibold">
                              Asked
                            </th>
                            <th scope="col" className="py-2 font-semibold">
                              Decide
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.pending.map((item) => (
                            <tr key={item.id} className="border-b border-[var(--color-border)]">
                              <Person item={item} />
                              <td className="py-2 pr-4">{item.note ?? "No note"}</td>
                              <td className="py-2 pr-4">{formatMoment(item.requestedAt)}</td>
                              <td className="py-2">
                                {decidable(item) ? (
                                  <div className="flex flex-wrap gap-2">
                                    <EarlyAccessDialog
                                      intent="approve"
                                      requestId={item.id}
                                      who={who(item)}
                                      trigger="Approve"
                                    />
                                    <EarlyAccessDialog
                                      intent="reject"
                                      requestId={item.id}
                                      who={who(item)}
                                      trigger="Reject"
                                    />
                                  </div>
                                ) : (
                                  <span className="text-sm">
                                    Your own request: another owner decides.
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </Stack>

              <Stack gap={3} asChild>
                <section aria-labelledby="ea-active">
                  <h2 id="ea-active" className="font-display text-2xl font-semibold">
                    Has access now ({list.approved.length})
                  </h2>
                  {list.approved.length === 0 ? (
                    <EmptyState
                      title="No one has early access"
                      data-testid="early-access-active-empty"
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <table
                        className="w-full border-collapse text-left"
                        data-testid="early-access-active"
                      >
                        <caption className="sr-only">
                          Active grants, the soonest to end first
                        </caption>
                        <thead>
                          <tr className="border-b border-[var(--color-border-strong)]">
                            <th scope="col" className="py-2 pr-4 font-semibold">
                              Who
                            </th>
                            <th scope="col" className="py-2 pr-4 font-semibold">
                              Ends
                            </th>
                            <th scope="col" className="py-2 pr-4 font-semibold">
                              Approved by
                            </th>
                            <th scope="col" className="py-2 font-semibold">
                              Change
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.approved.map((item) => (
                            <tr key={item.id} className="border-b border-[var(--color-border)]">
                              <Person item={item} />
                              <td className="py-2 pr-4">{endsAt(item)}</td>
                              <td className="py-2 pr-4">
                                {item.decidedByName ?? "Unknown"}
                                {item.decidedAt ? `, ${formatMoment(item.decidedAt)}` : ""}
                              </td>
                              <td className="py-2">
                                {decidable(item) ? (
                                  <div className="flex flex-wrap gap-2">
                                    <EarlyAccessDialog
                                      intent="approve"
                                      requestId={item.id}
                                      who={who(item)}
                                      trigger="Extend"
                                    />
                                    <EarlyAccessDialog
                                      intent="revoke"
                                      requestId={item.id}
                                      who={who(item)}
                                      trigger="Revoke"
                                    />
                                  </div>
                                ) : (
                                  <span className="text-sm">
                                    Your own access: another owner changes it.
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </Stack>

              <Stack gap={3} asChild>
                <section aria-labelledby="ea-history">
                  <h2 id="ea-history" className="font-display text-2xl font-semibold">
                    History
                  </h2>
                  {list.history.length === 0 ? (
                    <EmptyState
                      title="Nothing has ended yet"
                      data-testid="early-access-history-empty"
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <table
                        className="w-full border-collapse text-left"
                        data-testid="early-access-history"
                      >
                        <caption className="sr-only">
                          Rejected, revoked and expired, latest first
                        </caption>
                        <thead>
                          <tr className="border-b border-[var(--color-border-strong)]">
                            <th scope="col" className="py-2 pr-4 font-semibold">
                              Who
                            </th>
                            <th scope="col" className="py-2 pr-4 font-semibold">
                              How it ended
                            </th>
                            <th scope="col" className="py-2 pr-4 font-semibold">
                              When
                            </th>
                            <th scope="col" className="py-2 font-semibold">
                              Reason
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.history.map((item) => (
                            <tr key={item.id} className="border-b border-[var(--color-border)]">
                              <Person item={item} />
                              <td className="py-2 pr-4">
                                <Badge variant="neutral">
                                  {item.status === "approved" ? "expired" : item.status}
                                </Badge>
                              </td>
                              <td className="py-2 pr-4">
                                {formatMoment(item.decidedAt ?? item.expiresAt ?? item.requestedAt)}
                              </td>
                              <td className="py-2">{item.decisionReason ?? "None given"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </Stack>
            </>
          )}
        </Stack>
      </main>
    </Container>
  );
}
