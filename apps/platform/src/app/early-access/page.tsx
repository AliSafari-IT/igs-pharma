import { isDomainError } from "@igs/kernel";
import {
  EARLY_ACCESS_REASK_DAYS,
  type EarlyAccessList,
  type EarlyAccessListItem,
  listEarlyAccessRequests,
} from "@igs/module-identity";
import { Alert, Badge, Container, EmptyState, Stack } from "@igs/ui";
import type { ReactNode } from "react";

import { EarlyAccessDialog } from "../../components/early-access-dialog";
import { identityErrorMessage } from "../../components/identity-labels";
import { PageHeader } from "../../components/page-header";
import { formatMoment } from "../../components/stock-labels";
import { requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

export const metadata = { title: "Early access · IGS-Pharma Platform" };

/**
 * Early access (igs-pharma#199): who may see the webshop before it opens. Open requests first (the
 * oldest on top), then the active grants, then the recent history. Approving, rejecting and revoking
 * each ask for confirmation and a fresh passkey check; nobody decides their own request. Owner only
 * (`storefront.early_access.manage`); everyone else gets the refusal.
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
  const own = (item: EarlyAccessListItem) => item.userId === actor.id;

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={8}>
          <PageHeader
            title="Early access"
            description={`While the webshop is closed, approved customers can see it. A revoke or an expiry takes effect within 15 minutes. After a rejection or a revoke, a customer can ask again after ${EARLY_ACCESS_REASK_DAYS} days.`}
          />
          {error || !list ? (
            <Alert variant="error" title="You can't see early access">
              {identityErrorMessage(error ?? undefined)}
            </Alert>
          ) : (
            <>
              <Section
                title="Waiting for a decision"
                testId="early-access-pending"
                empty="No open requests."
                items={list.pending}
                columns={["Customer", "Note", "Asked", ""]}
                row={(item) => [
                  <Person key="p" item={item} />,
                  <span key="n" className="whitespace-pre-line">
                    {item.note ?? <span className="text-[var(--color-text-subtle)]">No note</span>}
                  </span>,
                  formatMoment(item.requestedAt),
                  own(item) ? (
                    <span key="a" className="text-sm text-[var(--color-text-subtle)]">
                      Your own request: another owner decides
                    </span>
                  ) : (
                    <div key="a" className="flex flex-wrap gap-2">
                      <EarlyAccessDialog
                        intent="approve"
                        requestId={item.id}
                        name={item.name ?? item.email ?? ""}
                        label="Approve"
                      />
                      <EarlyAccessDialog
                        intent="reject"
                        requestId={item.id}
                        name={item.name ?? item.email ?? ""}
                        label="Reject"
                      />
                    </div>
                  ),
                ]}
              />
              <Section
                title="Have access now"
                testId="early-access-approved"
                empty="Nobody has early access."
                items={list.approved}
                columns={["Customer", "Until", "Approved by", ""]}
                row={(item) => [
                  <Person key="p" item={item} />,
                  item.expiresAt ? formatMoment(item.expiresAt) : "Until the shop opens",
                  item.decidedByName ?? "",
                  own(item) ? (
                    <span key="a" className="text-sm text-[var(--color-text-subtle)]">
                      Your own access: another owner decides
                    </span>
                  ) : (
                    <div key="a" className="flex flex-wrap gap-2">
                      <EarlyAccessDialog
                        intent="approve"
                        requestId={item.id}
                        name={item.name ?? item.email ?? ""}
                        label="Extend"
                      />
                      <EarlyAccessDialog
                        intent="revoke"
                        requestId={item.id}
                        name={item.name ?? item.email ?? ""}
                        label="Revoke"
                      />
                    </div>
                  ),
                ]}
              />
              <Section
                title="History"
                testId="early-access-history"
                empty="Nothing decided yet."
                items={list.history}
                columns={["Customer", "Outcome", "Decided", "By"]}
                row={(item) => [
                  <Person key="p" item={item} />,
                  <Outcome key="o" item={item} />,
                  item.decidedAt ? formatMoment(item.decidedAt) : "",
                  item.decidedByName ?? "",
                ]}
              />
            </>
          )}
        </Stack>
      </main>
    </Container>
  );
}

function Person({ item }: { readonly item: EarlyAccessListItem }) {
  return (
    <span className="flex flex-col">
      <span className="font-medium">{item.name ?? "Invited"}</span>
      <span className="text-sm text-[var(--color-text-subtle)]">
        {item.email}{" "}
        {item.emailVerified ? null : <Badge variant="amber">E-mail not verified</Badge>}
      </span>
    </span>
  );
}

function Outcome({ item }: { readonly item: EarlyAccessListItem }) {
  const label =
    item.status === "approved" ? "Expired" : item.status === "rejected" ? "Rejected" : "Revoked";
  return (
    <span className="flex flex-col gap-1">
      <Badge variant={item.status === "approved" ? "neutral" : "error"}>{label}</Badge>
      {item.decisionReason ? (
        <span className="whitespace-pre-line text-sm">{item.decisionReason}</span>
      ) : null}
    </span>
  );
}

function Section({
  title,
  testId,
  empty,
  items,
  columns,
  row,
}: {
  readonly title: string;
  readonly testId: string;
  readonly empty: string;
  readonly items: readonly EarlyAccessListItem[];
  readonly columns: readonly string[];
  readonly row: (item: EarlyAccessListItem) => readonly ReactNode[];
}) {
  const headingId = `${testId}-heading`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="font-display text-2xl font-medium">
        {title} <span className="text-[var(--color-text-subtle)]">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <EmptyState title={empty} data-testid={`${testId}-empty`} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left" data-testid={testId}>
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-[var(--color-border-strong)]">
                {columns.map((column, index) => (
                  <th key={column || `c${index}`} scope="col" className="py-2 pr-4 font-semibold">
                    {column || <span className="sr-only">Actions</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  data-testid={`early-access-row-${item.id}`}
                  className="border-b border-[var(--color-border)] align-top"
                >
                  {row(item).map((cell, index) => (
                    // the cells of a row never move, so their position is a stable key
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed columns
                    <td key={index} className="py-2 pr-4">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
