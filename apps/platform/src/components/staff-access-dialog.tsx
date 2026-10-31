"use client";

import { authClient } from "@igs/auth/client";
import { Alert, Button, Stack } from "@igs/ui";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { type ChangeAccessState, changeAccess } from "../app/staff/actions";
import { authErrorMessage } from "./auth-errors";
import { identityErrorMessage } from "./identity-labels";

/** A role as the picker shows it: the key is what the form sends, the label what staff read. */
export interface RoleOption {
  readonly key: string;
  readonly label: string;
}

interface Props {
  readonly userId: string;
  readonly name: string;
  readonly status: "active" | "suspended";
  /** Roles this person holds. */
  readonly roles: readonly RoleOption[];
  /** Roles that can still be granted to them. */
  readonly grantable: readonly RoleOption[];
  /** The account holds a pharmacist role (D-035: the pharmacist actions apply). */
  readonly pharmacist: boolean;
}

/**
 * "Access" on the Staff page (igs-pharma#95): grant or revoke a role, suspend, reactivate or delete.
 * Each change is one small form with its own submission id. When the server answers that the
 * person's passkey check is older than 10 minutes, the dialog asks for the passkey and then submits
 * the SAME form again (the same submission id, so the change happens once); cancelling the passkey
 * prompt changes nothing.
 */
export function StaffAccessDialog({ userId, name, status, roles, grantable, pharmacist }: Props) {
  const [state, action, pending] = useActionState(changeAccess, {} as ChangeAccessState);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  // one id per dialog opening and per change: a retry re-sends it, a new change gets a new one
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const needsFreshProof = state.error === "identity.fresh_mfa_required";

  useEffect(() => {
    setAnswers((count) => count + 1);
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

  // controlled on purpose: React resets an uncontrolled form once its action finishes, and the
  // retry after the passkey check must repeat exactly what was chosen
  const [intent, setIntent] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [answers, setAnswers] = useState(0);
  /** Remembers which button was pressed, so the retry after the passkey check repeats it. */
  const choose = (next: string) => () => setIntent(next);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => dialog.current?.showModal()}>
        Access
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        className="m-auto w-full max-w-lg rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 text-[var(--color-text)] shadow-lg backdrop:bg-black/50"
      >
        <form ref={form} action={action}>
          <Stack gap={4}>
            <h2 id={`${id}-title`} className="font-display text-2xl font-semibold">
              Access of {name}
            </h2>
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="pharmacist" value={pharmacist ? "1" : "0"} />
            <input type="hidden" name="submissionId" value={submissionId} />
            <input type="hidden" name="intent" value={intent} />
            <input type="hidden" name="roleKey" value={roleKey} />
            <fieldset className="flex flex-col gap-2">
              <legend className="font-semibold">Role</legend>
              <label className="flex items-center gap-2">
                <span>Role</span>
                <select
                  // remounted after every answer: React resets a form when its action finishes,
                  // and a controlled select would keep showing the reset value
                  key={answers}
                  value={roleKey}
                  onChange={(event) => setRoleKey(event.target.value)}
                  className="rounded border border-[var(--color-border)] p-1"
                >
                  <option value="">Choose a role</option>
                  {grantable.map((role) => (
                    <option key={`g-${role.key}`} value={role.key}>
                      Grant: {role.label}
                    </option>
                  ))}
                  {roles.map((role) => (
                    <option key={`r-${role.key}`} value={role.key}>
                      Currently held: {role.label}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            {needsFreshProof ? (
              <Alert variant="info" title="Confirm it's you first">
                For this change your own passkey must have confirmed it's you in the last 10
                minutes.
              </Alert>
            ) : state.error ? (
              <Alert variant="error" title="That was not changed">
                {identityErrorMessage(state.error)}
              </Alert>
            ) : null}
            {confirmError ? (
              <Alert variant="error" title="That didn't work">
                {confirmError}
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {needsFreshProof ? (
                <Button type="button" onClick={confirmAndRetry} loading={pending}>
                  Confirm with your passkey
                </Button>
              ) : (
                <>
                  <Button type="submit" onClick={choose("grant")} loading={pending}>
                    Grant role
                  </Button>
                  <Button
                    type="submit"
                    onClick={choose("revoke")}
                    variant="secondary"
                    loading={pending}
                  >
                    Revoke role
                  </Button>
                  {status === "active" ? (
                    <Button
                      type="submit"
                      onClick={choose("suspend")}
                      variant="secondary"
                      loading={pending}
                    >
                      Suspend
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      onClick={choose("reactivate")}
                      variant="secondary"
                      loading={pending}
                    >
                      Reactivate
                    </Button>
                  )}
                  <Button
                    type="submit"
                    onClick={choose("delete")}
                    variant="danger"
                    loading={pending}
                  >
                    Delete account
                  </Button>
                </>
              )}
              <Button type="button" variant="ghost" onClick={() => dialog.current?.close()}>
                Cancel
              </Button>
            </div>
          </Stack>
        </form>
      </dialog>
    </>
  );
}
