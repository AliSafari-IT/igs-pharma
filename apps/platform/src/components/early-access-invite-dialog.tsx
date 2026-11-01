"use client";

import { authClient } from "@igs/auth/client";
import { Alert, Button, Stack, TextField } from "@igs/ui";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { type EarlyAccessDecisionState, inviteToEarlyAccess } from "../app/early-access/actions";
import { authErrorMessage } from "./auth-errors";
import {
  EARLY_ACCESS_DURATION_LABELS,
  EARLY_ACCESS_DURATION_ORDER,
  INVITE_LOCALE_LABELS,
} from "./early-access-labels";
import { identityErrorMessage } from "./identity-labels";

const LOCALES = Object.keys(INVITE_LOCALE_LABELS) as (keyof typeof INVITE_LOCALE_LABELS)[];

/**
 * Invite an e-mail address to early access (igs-pharma#211). The same dialog rules as the decisions
 * (`EarlyAccessDialog`): Cancel focused first, a fresh passkey check, and when the server asks for it
 * the dialog confirms the passkey and submits the SAME form again (same submission id, so one
 * invitation); closing the dialog while the passkey prompt is open sends nothing. The answer is the same
 * whether or not the address has an account.
 */
export function EarlyAccessInviteDialog() {
  const [state, action, pending] = useActionState(
    inviteToEarlyAccess,
    {} as EarlyAccessDecisionState,
  );
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  /** Advances on every close: a passkey check started before it submits nothing. */
  const attempt = useRef(0);
  const [stale, setStale] = useState(false);
  const id = useId();
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  // controlled: the retry after the passkey check repeats exactly what was entered
  const [email, setEmail] = useState("");
  const [duration, setDuration] = useState("30d");
  const [locale, setLocale] = useState("nl");
  const error = stale ? undefined : state.error;
  const needsFreshProof = error === "identity.fresh_mfa_required";

  useEffect(() => {
    setStale(false);
    if (state.done) {
      setSubmissionId(crypto.randomUUID());
      setEmail("");
      setSent(true);
      close();
    }
  }, [state]);

  async function confirmAndRetry() {
    setConfirmError(null);
    const started = attempt.current;
    try {
      const result = await authClient.signIn.passkey();
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
    setSent(false);
    setConfirmError(null);
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLButtonElement>("[data-cancel]")?.focus();
  }

  function close() {
    attempt.current += 1;
    dialog.current?.close();
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={open} data-testid="early-access-invite">
        Invite by e-mail
      </Button>
      {sent ? (
        <output className="text-sm" data-testid="early-access-invite-sent">
          Invitation saved. If that address already has a confirmed account, they have access now;
          otherwise they get it when they sign up with it and confirm it.
        </output>
      ) : null}
      <dialog
        ref={dialog}
        onClose={() => {
          attempt.current += 1;
        }}
        aria-labelledby={`${id}-title`}
        className="m-auto w-full max-w-lg rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 text-[var(--color-text)] shadow-lg backdrop:bg-black/50"
      >
        <form ref={form} action={action}>
          <Stack gap={4}>
            <h2 id={`${id}-title`} className="font-display text-2xl font-semibold">
              Invite someone to early access
            </h2>
            <p>
              They get a mail asking them to create an account with this address and confirm it
              within 30 days; then the shop opens for them. The mail has no link that grants access
              by itself.
            </p>
            <input type="hidden" name="submissionId" value={submissionId} />
            <TextField
              label="E-mail address"
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
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
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Language of the mail</span>
              <select
                name="locale"
                value={locale}
                onChange={(event) => setLocale(event.target.value)}
                className="rounded border border-[var(--color-border)] p-2"
              >
                {LOCALES.map((value) => (
                  <option key={value} value={value}>
                    {INVITE_LOCALE_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            {needsFreshProof ? (
              <Alert variant="info" title="Confirm it's you first">
                To invite, your own passkey must have confirmed it's you in the last 10 minutes.
              </Alert>
            ) : error ? (
              <Alert variant="error" title="Nobody was invited">
                {identityErrorMessage(error)}
              </Alert>
            ) : null}
            {confirmError ? (
              <Alert variant="error" title="That didn't work">
                {confirmError}
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" data-cancel onClick={close}>
                Cancel
              </Button>
              {needsFreshProof ? (
                <Button type="button" onClick={confirmAndRetry} loading={pending}>
                  Confirm with your passkey
                </Button>
              ) : (
                <Button type="submit" loading={pending}>
                  Send invitation
                </Button>
              )}
            </div>
          </Stack>
        </form>
      </dialog>
    </div>
  );
}
