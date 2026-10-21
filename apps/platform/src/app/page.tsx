import { DEFAULT_LOW_STOCK } from "@igs/module-inventory";
import { Container, Link } from "@igs/ui";

import { DashboardTile, Stat } from "../components/dashboard-tile";
import { NeedsAttention } from "../components/needs-attention";
import { PageHeader } from "../components/page-header";
import { needsAttention } from "../lib/dashboard";
import { currentActor, requireStaffActor } from "../server/actor";
import { loadDashboard } from "../server/dashboard";
import { ensureKernelConfigured } from "../server/kernel";

/**
 * The back-office home (igs-pharma#115). A signed-in staff member sees the tiles they may see; a
 * visitor who is not signed in sees a plain page with a way in (the staff pages themselves send
 * them to sign in).
 */
export default async function DashboardPage() {
  if (!(await currentActor())) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold text-[var(--color-primary)]">IGS-Pharma Platform</h1>
        <p className="mt-4">
          <Link href="/sign-in">Sign in</Link>
        </p>
      </main>
    );
  }
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const { products, stock, reservations, requests, orders } = await loadDashboard(actor);
  const none = !products && !stock && !reservations && !requests;

  return (
    <Container asChild size="lg">
      <main className="py-8">
        <PageHeader title="Dashboard" />
        {none ? (
          <p className="mt-4 max-w-prose text-[var(--color-text-subtle)]">
            Nothing to show here for your role yet. Use the menu to open a page.
          </p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {products ? (
              <DashboardTile
                id="products"
                title="Products"
                result={products}
                href="/products"
                linkLabel="Open products"
              >
                {(counts) => (
                  <dl className="grid grid-cols-3 gap-3">
                    <Stat label="Active" value={counts.active} />
                    <Stat label="Draft" value={counts.draft} />
                    <Stat
                      label="Awaiting approval"
                      value={counts.awaitingApproval}
                      tone="attention"
                    />
                  </dl>
                )}
              </DashboardTile>
            ) : null}
            {stock ? (
              <DashboardTile
                id="stock"
                title="Stock alerts"
                result={stock}
                href="/stock"
                linkLabel="Open stock"
              >
                {(alerts) => (
                  <dl className="grid grid-cols-3 gap-3">
                    <Stat
                      label={`Low (1 to ${DEFAULT_LOW_STOCK})`}
                      value={alerts.low}
                      tone="attention"
                    />
                    <Stat label="Out of stock" value={alerts.out} tone="attention" />
                    <Stat label="Short for orders" value={alerts.short} tone="attention" />
                  </dl>
                )}
              </DashboardTile>
            ) : null}
            {reservations ? (
              <DashboardTile
                id="reservations"
                title="Active reservations"
                result={reservations}
                href="/stock"
                linkLabel="Open stock"
              >
                {(counts) =>
                  counts.active === 0 ? (
                    <p className="text-[var(--color-text-subtle)]">No active reservations.</p>
                  ) : (
                    <dl className="grid grid-cols-2 gap-3">
                      <Stat label="Orders and checkout holds" value={counts.active} />
                    </dl>
                  )
                }
              </DashboardTile>
            ) : null}
            {requests ? (
              <DashboardTile
                id="requests"
                title="Data requests"
                result={requests}
                href="/privacy/requests"
                linkLabel="Open data requests"
              >
                {(counts) =>
                  counts.open === 0 ? (
                    <p className="text-[var(--color-text-subtle)]">No open data requests.</p>
                  ) : (
                    <dl className="grid grid-cols-2 gap-3">
                      <Stat label="Open" value={counts.open} />
                      <Stat label="Overdue" value={counts.overdue} tone="attention" />
                    </dl>
                  )
                }
              </DashboardTile>
            ) : null}
          </div>
        )}
        {products || stock || requests || orders ? (
          <NeedsAttention attention={needsAttention({ orders, products, stock, requests })} />
        ) : null}
      </main>
    </Container>
  );
}
