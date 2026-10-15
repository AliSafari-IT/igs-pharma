import { Alert, Link } from "@igs/ui";

import { AuthFrame } from "../../components/auth-frame";
import { TwoStepSetup } from "../../components/two-step-setup";
import { currentActor, needsTwoStep } from "../../server/actor";

export const metadata = { title: "Set up 2-step login · IGS-Pharma Platform" };

/**
 * 36b: a staff member whose session has not proved a second factor lands here instead of the
 * back-office (the kernel refuses them every operation until then).
 */
export default async function SetupPage() {
  const actor = await currentActor();
  return (
    <AuthFrame title="Set up 2-step login">
      {!actor ? (
        <Alert variant="info" title="You are not signed in">
          <Link href="/sign-in">Sign in</Link> first, or open your enrolment link again.
        </Alert>
      ) : needsTwoStep(actor) ? (
        <>
          <p className="text-[var(--color-text-muted)]">
            The back-office holds patient and pharmacy data, so every staff sign-in needs a second
            step.
          </p>
          <TwoStepSetup
            passkeys={actor.profile.factors.passkeys}
            totp={actor.profile.factors.totp}
          />
        </>
      ) : (
        <Alert variant="success" title="2-step login is on">
          <Link href="/account">Go to your account</Link>
        </Alert>
      )}
    </AuthFrame>
  );
}
