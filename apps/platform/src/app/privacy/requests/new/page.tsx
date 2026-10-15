import { Container, Stack } from "@igs/ui";

import { DsrRequestForm } from "../../../../components/dsr-request-form";
import { PageHeader } from "../../../../components/page-header";
import { requireStaffActor } from "../../../../server/actor";

export const metadata = { title: "New data request · IGS-Pharma Platform" };

const brusselsDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" });

/** Log a data-subject request received by e-mail, post or in the pharmacy (igs-pharma#58). */
export default async function NewDataRequestPage() {
  await requireStaffActor();
  const today = brusselsDay.format(new Date());
  return (
    <Container asChild size="md">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader
            title="New data request"
            back={{ href: "/privacy/requests", label: "Back to data requests" }}
            description="The one-month deadline starts on the day the request was received, not the day you log it."
          />
          <DsrRequestForm today={today} />
        </Stack>
      </main>
    </Container>
  );
}
