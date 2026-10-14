"use client";

import { authClient } from "@igs/auth/client";
import { Alert, Button, Stack } from "@igs/ui";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { type ResetSignInState, resetSignIn } from "../app/staff/actions";
import { authErrorMessage } from "./auth-errors";
import { identityErrorMessage } from "./identity-labels";

interface Props {
  readonly userId: string;
  readonly name: string;
}

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeStyle: "short",
  timeZone: "Europe/Brussels",
});

/**
 * "Reset sign-in" on the Staff page (igs-pharma#90). Confirms first (it signs the person out
 * everywhere and deletes their passkeys), then shows the new enrolment link ONCE. When the owner's
 * own 2-step proof is older than 10 minutes, it asks for their passkey and then retries.
 */
export function ResetSignInDialog({ userId, name }: Props) {
  const [state, action, pending] = useActionState(resetSignIn, {} as ResetSignInState);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  // one id per dialog: a double click or the resubmit after the passkey check re-sends it (#110)
  const [submissionId] = useState(() => crypto.randomUUID());
  const needsFreshProof = state.error === "identity.fresh_mfa_required";

  useEffect(() => {
    if ((state.error || state.link) && !dialog.current?.open) dialog.current?.showModal();
  }, [state]);

  async function confirmAndRetry() {
    setConfirmError(null);
    try {
      const result = await authClient.signIn.passkey();
      if (result?.error) {
        setConfirmError(authErrorMessage(result.error));
        return;
      }
      form.current?.requestSubmit();
    } catch {
      setConfirmError(authErrorMessage(null));
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => dialog.current?.showModal()}>
        Reset sign-in
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        className="m-auto w-full max-w-lg rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 text-[var(--color-text)] shadow-lg backdrop:bg-[var(--color-text)]/40"
      >
        <Stack gap={4}>
          <h2 id={`${id}-title`} className="font-display text-2xl font-semibold">
            Reset sign-in of {name}
          </h2>
          {state.link ? (
            <>
              <Alert variant="success" title="Sign-in reset">
                Their passkeys and authenticator apps are deleted and they are signed out
                everywhere.
              </Alert>
              <p>
                Send them this link through a channel you trust (in person, a call, a secure
                messenger). It works once, until{" "}
                {state.expiresAt ? timeFormat.format(new Date(state.expiresAt)) : "15 minutes"}. It
                is not shown again.
              </p>
              <p>
                <code className="block break-all rounded-[var(--radius-md)] bg-[var(--color-surface)] p-3">
                  {state.link}
                </code>
              </p>
              <div>
                <Button variant="ghost" onClick={() => dialog.current?.close()}>
                  Close
                </Button>
              </div>
            </>
          ) : (
            <form ref={form} action={action}>
              <Stack gap={4}>
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="submissionId" value={submissionId} />
                <p>
                  This deletes all their passkeys and authenticator apps and signs them out
                  everywhere. You get a new link for them to set up a passkey again.
                </p>
                {needsFreshProof ? (
                  <Alert variant="info" title="Confirm it's you first">
                    For this change your own passkey must have confirmed it's you in the last 10
                    minutes.
                  </Alert>
                ) : state.error ? (
                  <Alert variant="error" title="The sign-in was not reset">
                    {identityErrorMessage(state.error)}
                  </Alert>
                ) : null}
                {confirmError ? (
                  <Alert variant="error" title="That didn't work">
                    {confirmError}
                  </Alert>
                ) : null}
                <div className="flex gap-3">
                  {needsFreshProof ? (
                    <Button type="button" onClick={confirmAndRetry} loading={pending}>
                      Confirm with your passkey
                    </Button>
                  ) : (
                    <Button type="submit" loading={pending}>
                      Reset sign-in
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => dialog.current?.close()}>
                    Cancel
                  </Button>
                </div>
              </Stack>
            </form>
          )}
        </Stack>
      </dialog>
    </>
  );
}
