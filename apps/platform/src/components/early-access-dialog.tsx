"use client";

import { authClient } from "@igs/auth/client";
import { Alert, Button, Label, Select, Stack, Textarea } from "@igs/ui";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { type EarlyAccessDecisionState, decideEarlyAccess } from "../app/early-access/actions";
import { authErrorMessage } from "./auth-errors";
import { identityErrorMessage } from "./identity-labels";

export type EarlyAccessIntent = "approve" | "reject" | "revoke";

/** How long an approval lasts, as the picker offers it (igs-pharma#199: 30 days by default). */
export const DURATION_OPTIONS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "until_launch", label: "Until the shop opens to everyone" },
] as const;

const COPY: Record<
  EarlyAccessIntent,
  { readonly title: string; readonly intro: string; readonly submit: string }
> = {
  approve: {
    title: "Approve early access",
    intro:
      "They can see the shop, and order when the cart is on, until the date you choose. They get an e-mail.",
    submit: "Approve",
  },
  reject: {
    title: "Reject the request",
    intro:
      "They get an e-mail and can ask again after 30 days. The reason is shown to them on their early-access page, not in the mail.",
    submit: "Reject",
  },
  revoke: {
    title: "Revoke early access",
    intro:
      "Their access ends within 15 minutes (when their current pass runs out). They get an e-mail and can ask again after 30 days.",
    submit: "Revoke",
  },
};

interface Props {
  readonly intent: EarlyAccessIntent;
  readonly requestId: string;
  readonly name: string;
  /** The button that opens the dialog. */
  readonly label: string;
}

/**
 * One early-access decision (igs-pharma#199) in a native `<dialog>`: Cancel comes first and has the
 * focus, so Enter or a stray click never decides. When the server answers that the owner's passkey
 * check is older than 10 minutes, the dialog asks for the passkey and submits the SAME form again (the
 * same submission id, so the decision happens once); cancelling the passkey prompt changes nothing.
 */
export function EarlyAccessDialog({ intent, requestId, name, label }: Props) {
  const [state, action, pending] = useActionState(
    decideEarlyAccess,
    {} as EarlyAccessDecisionState,
  );
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  // controlled: React resets a form after its action, and the retry must repeat what was chosen
  const [duration, setDuration] = useState("30d");
  const [reason, setReason] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  const copy = COPY[intent];
  const needsFreshProof = state.error === "identity.fresh_mfa_required";

  useEffect(() => {
    if (state.done) {
      setSubmissionId(crypto.randomUUID());
      dialog.current?.close();
    }
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
      <Button
        size="sm"
        variant={intent === "approve" ? "primary" : "secondary"}
        onClick={() => {
          dialog.current?.showModal();
          // showModal focuses the first field; the safe choice has the focus instead (#199)
          dialog.current?.querySelector<HTMLButtonElement>("[data-cancel]")?.focus();
        }}
        data-testid={`early-access-${intent}-${requestId}`}
      >
        {label}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        className="m-auto w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 text-[var(--color-text)] shadow-lg backdrop:bg-black/50"
      >
        <form ref={form} action={action}>
          <Stack gap={4}>
            <h2 id={`${id}-title`} className="font-display text-2xl font-semibold">
              {copy.title}
            </h2>
            <p>
              <span className="font-medium">{name}</span>
            </p>
            <p className="text-[var(--color-text-subtle)]">{copy.intro}</p>
            <input type="hidden" name="intent" value={intent} />
            <input type="hidden" name="requestId" value={requestId} />
            <input type="hidden" name="submissionId" value={submissionId} />
            {intent === "approve" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-duration`} required>
                  For how long
                </Label>
                <Select
                  id={`${id}-duration`}
                  name="duration"
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                >
                  {DURATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-reason`}>Reason (optional, shown to them)</Label>
                <Textarea
                  id={`${id}-reason`}
                  name="reason"
                  maxLength={500}
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
            )}
            {needsFreshProof ? (
              <Alert variant="info" title="Confirm it's you first">
                For this decision your own passkey must have confirmed it's you in the last 10
                minutes.
              </Alert>
            ) : state.error ? (
              <Alert variant="error" title="Nothing was changed">
                {identityErrorMessage(state.error)}
              </Alert>
            ) : null}
            {confirmError ? (
              <Alert variant="error" title="That didn't work">
                {confirmError}
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {/* Cancel first and focused (#199): a decision is never the default */}
              <Button
                type="button"
                variant="ghost"
                data-cancel
                onClick={() => dialog.current?.close()}
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
                  data-testid={`early-access-submit-${intent}`}
                >
                  {copy.submit}
                </Button>
              )}
            </div>
          </Stack>
        </form>
      </dialog>
    </>
  );
}
