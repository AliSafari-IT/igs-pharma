import { Container, Link, Stack } from "@igs/ui";

import { DsrRequestForm } from "../../../../components/dsr-request-form";
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
          <Link href="/privacy/requests">Back to data requests</Link>
          <h1 className="font-display text-4xl font-medium text-[var(--color-primary)]">
            New data request
          </h1>
          <p className="max-w-prose text-[var(--color-text-subtle)]">
            The 30-day deadline starts on the day the request was received, not the day you log it.
          </p>
          <DsrRequestForm today={today} />
        </Stack>
      </main>
    </Container>
  );
}
