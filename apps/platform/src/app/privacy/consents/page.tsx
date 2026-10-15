import { Container, Stack } from "@igs/ui";

import { ConsentsPanel } from "../../../components/consents-panel";
import { PageHeader } from "../../../components/page-header";
import { requireStaffActor } from "../../../server/actor";

export const metadata = { title: "Consents · IGS-Pharma Platform" };

/**
 * Look up what a person consented to, and record a consent given or withdrawn in the pharmacy or by
 * phone (igs-pharma#58). The current state is the latest change; nothing is ever overwritten.
 */
export default async function ConsentsPage() {
  await requireStaffActor();
  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader
            title="Consents"
            description="Every change is kept as proof. To change a consent, record a new one."
            back={{ href: "/privacy/requests", label: "Data requests" }}
          />
          <ConsentsPanel />
        </Stack>
      </main>
    </Container>
  );
}
