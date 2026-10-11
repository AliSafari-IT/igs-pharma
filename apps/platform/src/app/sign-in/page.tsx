import { Container, Stack } from "@igs/ui";
import { redirect } from "next/navigation";

import { PasskeySignIn } from "../../components/passkey-sign-in";
import { currentActor, needsTwoStep } from "../../server/actor";

export const metadata = { title: "Sign in · IGS-Pharma Platform" };

export default async function SignInPage() {
  const actor = await currentActor();
  if (actor) redirect(needsTwoStep(actor) ? "/setup" : "/account");
  return (
    <Container asChild size="sm">
      <main className="py-10">
        <Stack gap={6}>
          <h1 className="font-display text-4xl font-medium text-[var(--color-primary)]">
            Sign in to the back-office
          </h1>
          <p className="text-[var(--color-text-muted)]">
            Use the passkey on your phone, computer or security key.
          </p>
          <PasskeySignIn />
        </Stack>
      </main>
    </Container>
  );
}
