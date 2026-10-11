import { Container, Stack } from "@igs/ui";

import { RedeemEnrolment } from "../../components/redeem-enrolment";

export const metadata = { title: "Welcome · IGS-Pharma Platform" };

/** Landing page of a bootstrap enrolment link (36b): `/enrol#token=…`. */
export default function EnrolPage() {
  return (
    <Container asChild size="sm">
      <main className="py-10">
        <Stack gap={6}>
          <h1 className="font-display text-4xl font-medium text-[var(--color-primary)]">
            Welcome to the back-office
          </h1>
          <p className="text-[var(--color-text-muted)]">
            Next you set up 2-step login, so only you can sign in to your account.
          </p>
          <RedeemEnrolment />
        </Stack>
      </main>
    </Container>
  );
}
