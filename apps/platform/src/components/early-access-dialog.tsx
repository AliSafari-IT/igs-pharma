"use client";

import { authClient } from "@igs/auth/client";
import { Alert, Button, Stack, TextField } from "@igs/ui";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { type EarlyAccessDecisionState, decideEarlyAccess } from "../app/early-access/actions";
import { authErrorMessage } from "./auth-errors";
import {
  EARLY_ACCESS_DURATION_LABELS,
  EARLY_ACCESS_DURATION_ORDER,
  EARLY_ACCESS_INTENT_LABELS,
  type EarlyAccessIntent,
} from "./early-access-labels";
import { identityErrorMessage } from "./identity-labels";

interface Props {
  readonly intent: EarlyAccessIntent;
  readonly requestId: string;
  /** Who the request is from, as the dialog names them. */
  readonly who: string;
  /** The button on the row: "Approve", "Extend", "Reject", "Revoke". */
  readonly trigger: string;
}

/**
 * Approve (or extend), reject or revoke one early-access request (igs-pharma#199). One native
 * `<dialog>` per action, Cancel focused first so Enter never decides by accident. When the server
 * answers that the owner's passkey check is older than 10 minutes, the dialog asks for the passkey
 * and then submits the SAME form again (the same submission id, so the decision happens once);
 * cancelling the passkey prompt decides nothing, and neither does closing the dialog while that
 * prompt is still open (a passkey check that finishes afterwards submits nothing).
 */
export function EarlyAccessDialog({ intent, requestId, who, trigger }: Props) {
  const [state, action, pending] = useActionState(
    decideEarlyAccess,
    {} as EarlyAccessDecisionState,
  );
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  /**
   * Advances every time the dialog closes (Cancel, Escape, a decision). A passkey check started
   * before that must not submit when it finishes: the owner cancelled. Advanced synchronously in
   * Cancel too, since the `close` event fires later than a passkey result can arrive.
   */
  const attempt = useRef(0);
  /** The last answer is from an earlier opening: hide it (a stale "confirm first" or error). */
  const [stale, setStale] = useState(false);
  const id = useId();
  // one id per dialog opening and per decision: a retry re-sends it, a new decision gets a new one
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  // controlled on purpose: React resets an uncontrolled form once its action finishes, and the
  // retry after the passkey check must repeat exactly what was chosen
  const [duration, setDuration] = useState("30d");
  const [reason, setReason] = useState("");
  const error = stale ? undefined : state.error;
  const needsFreshProof = error === "identity.fresh_mfa_required";
  const labels = EARLY_ACCESS_INTENT_LABELS[intent];

  useEffect(() => {
    // a new answer from the server: show it
    setStale(false);
    if (state.done) {
      setSubmissionId(crypto.randomUUID());
      setReason("");
      close();
    }
  }, [state]);

  async function confirmAndRetry() {
    setConfirmError(null);
    const started = attempt.current;
    try {
      const result = await authClient.signIn.passkey();
      // closed (or closed and reopened) while the passkey prompt was open: decide nothing
      if (started !== attempt.current) return;
      if (result?.error) {
        setConfirmError(authErrorMessage(result.error));
        return;
      }
      form.current?.requestSubmit();
    } catch {
      if (started === attempt.current) setConfirmError(authErrorMessage(null));
    }
  }

  function open() {
    setStale(true);
    setConfirmError(null);
    dialog.current?.showModal();
    // showModal focuses the first field; the safe choice has the focus instead (`autoFocus` only
    // acts when the button mounts, long before the dialog opens)
    dialog.current?.querySelector<HTMLButtonElement>("[data-cancel]")?.focus();
  }

  function close() {
    attempt.current += 1;
    dialog.current?.close();
  }

  return (
    <>
      <Button variant={intent === "approve" ? "primary" : "secondary"} size="sm" onClick={open}>
        {trigger}
      </Button>
      <dialog
        ref={dialog}
        // Escape closes without Cancel: the same rule
        onClose={() => {
          attempt.current += 1;
        }}
        aria-labelledby={`${id}-title`}
        className="m-auto w-full max-w-lg rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 text-[var(--color-text)] shadow-lg backdrop:bg-black/50"
      >
        <form ref={form} action={action}>
          <Stack gap={4}>
            <h2 id={`${id}-title`} className="font-display text-2xl font-semibold">
              {labels.title} {who}
            </h2>
            <p>{labels.description}</p>
            <input type="hidden" name="intent" value={intent} />
            <input type="hidden" name="requestId" value={requestId} />
            <input type="hidden" name="submissionId" value={submissionId} />
            {intent === "approve" ? (
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Access lasts</span>
                <select
                  name="duration"
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                  className="rounded border border-[var(--color-border)] p-2"
                >
                  {EARLY_ACCESS_DURATION_ORDER.map((value) => (
                    <option key={value} value={value}>
                      {EARLY_ACCESS_DURATION_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <TextField
                label="Reason (optional)"
                name="reason"
                maxLength={500}
                autoComplete="off"
                hint="They read it on their early-access page when signed in; the mail does not quote it. Don't put anything private in it."
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
            {needsFreshProof ? (
              <Alert variant="info" title="Confirm it's you first">
                For this decision your own passkey must have confirmed it's you in the last 10
                minutes.
              </Alert>
            ) : error ? (
              <Alert variant="error" title="That was not decided">
                {identityErrorMessage(error)}
              </Alert>
            ) : null}
            {confirmError ? (
              <Alert variant="error" title="That didn't work">
                {confirmError}
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                // first in the dialog and focused on open: a stray Enter cancels rather than decides
                data-cancel
                onClick={close}
              >
                Cancel
              </Button>
              {needsFreshProof ? (
                <Button type="button" onClick={confirmAndRetry} loading={pending}>
                  Confirm with your passkey
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant={intent === "approve" ? "primary" : "danger"}
                  loading={pending}
                >
                  {labels.confirm}
                </Button>
              )}
            </div>
          </Stack>
        </form>
      </dialog>
    </>
  );
}
