import { Alert } from "@igs/ui";
import { redirect } from "next/navigation";

import { AuthFrame } from "../../components/auth-frame";
import { PasskeySignIn } from "../../components/passkey-sign-in";
import { currentActor, needsTwoStep } from "../../server/actor";

export const metadata = { title: "Sign in · IGS-Pharma Platform" };

/** Why the person was signed out (#95); only these two reasons are ever shown. */
const REASONS: Readonly<Record<string, string>> = {
  expired: "Signed out after 8 hours. Sign in again to continue.",
  idle: "Signed out after 30 minutes without activity. Sign in again to continue.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}) {
  const { reason } = await searchParams;
  const notice = typeof reason === "string" ? REASONS[reason] : undefined;
  const actor = await currentActor();
  if (actor) redirect(needsTwoStep(actor) ? "/setup" : "/account");
  return (
    <AuthFrame title="Sign in to the back-office">
      <p className="text-[var(--color-text-muted)]">
        Use the passkey on your phone, computer or security key.
      </p>
      {notice ? (
        <Alert variant="info" title="You were signed out">
          {notice}
        </Alert>
      ) : null}
      <PasskeySignIn />
    </AuthFrame>
  );
}
