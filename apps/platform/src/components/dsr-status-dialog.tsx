"use client";

import type { DsrStatus } from "@igs/module-privacy";
import { Alert, Button, FieldError, Label, Select, Stack, Textarea } from "@igs/ui";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { type DsrStatusState, changeStatus } from "../app/privacy/actions";
import { DSR_STATUS_LABELS, privacyErrorMessage } from "./privacy-labels";

interface Props {
  readonly requestId: string;
  /** The statuses the request may move to now. */
  readonly nextStatuses: readonly DsrStatus[];
}

/**
 * The Change status dialog on a request page (igs-pharma#58). The note is optional, except when
 * rejecting: then it is the reason, and it is required.
 */
export function DsrStatusDialog({ requestId, nextStatuses }: Props) {
  const [state, action, pending] = useActionState(changeStatus, {} as DsrStatusState);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [to, setTo] = useState<string>(state.values?.["to"] ?? nextStatuses[0] ?? "");
  const rejecting = to === "rejected";
  const noteError = state.error === "privacy.dsr_reason_required";

  // keep the dialog open to show a refusal
  useEffect(() => {
    if (state.error && !dialog.current?.open) dialog.current?.showModal();
  }, [state]);

  return (
    <>
      <Button variant="secondary" onClick={() => dialog.current?.showModal()}>
        Change status
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        className="m-auto w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 text-[var(--color-text)] shadow-lg backdrop:bg-black/50"
      >
        <form action={action} noValidate>
          <Stack gap={4}>
            <h2 id={`${id}-title`} className="font-display text-2xl font-semibold">
              Change status
            </h2>
            <input type="hidden" name="requestId" value={requestId} />
            {state.error && !noteError ? (
              <Alert variant="error" title="The status was not changed">
                {privacyErrorMessage(state.error)}
              </Alert>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-to`} required>
                New status
              </Label>
              <Select
                id={`${id}-to`}
                name="to"
                required
                value={to}
                onChange={(event) => setTo(event.target.value)}
              >
                {nextStatuses.map((status) => (
                  <option key={status} value={status}>
                    {DSR_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-note`} required={rejecting}>
                {rejecting ? "Reason for rejecting" : "Note"}
              </Label>
              <Textarea
                id={`${id}-note`}
                name="note"
                required={rejecting}
                maxLength={1000}
                rows={3}
                defaultValue={state.values?.["note"] ?? ""}
                key={`note-${state.values?.["note"] ?? ""}`}
                invalid={noteError}
                aria-describedby={noteError ? `${id}-note-error` : undefined}
              />
              {noteError ? (
                <FieldError id={`${id}-note-error`}>Say why the request is rejected.</FieldError>
              ) : null}
            </div>
            <div className="flex gap-3">
              <Button type="submit" loading={pending}>
                Save status
              </Button>
              <Button variant="ghost" onClick={() => dialog.current?.close()}>
                Cancel
              </Button>
            </div>
          </Stack>
        </form>
      </dialog>
    </>
  );
}
