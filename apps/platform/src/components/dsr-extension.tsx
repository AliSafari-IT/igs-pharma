"use client";

import { Alert, Button, Label, Select, Stack, TextField } from "@igs/ui";
import { useActionState, useEffect, useId, useRef } from "react";

import { type DsrExtensionState, extendRequest, recordNotice } from "../app/privacy/actions";
import { DSR_EXTENSION_REASON_OPTIONS, privacyErrorMessage } from "./privacy-labels";

const brusselsDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" });

/**
 * "Extend deadline" on a request page (art. 12(3) GDPR, igs-pharma#88): by one or two months, for a
 * reason. Shown only while the request is open, not yet extended and before its original deadline.
 */
export function DsrExtendDialog({ requestId }: { readonly requestId: string }) {
  const [state, action, pending] = useActionState(extendRequest, {} as DsrExtensionState);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    if (state.error && !dialog.current?.open) dialog.current?.showModal();
  }, [state]);

  return (
    <>
      <Button variant="secondary" onClick={() => dialog.current?.showModal()}>
        Extend deadline
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        className="m-auto w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 text-[var(--color-text)] shadow-lg backdrop:bg-black/50"
      >
        <form action={action} noValidate>
          <Stack gap={4}>
            <h2 id={`${id}-title`} className="font-display text-2xl font-semibold">
              Extend deadline
            </h2>
            <input type="hidden" name="requestId" value={requestId} />
            <p>
              GDPR allows up to two more months for a complex request or many requests. You must
              tell the person, with the reason, before the first month ends.
            </p>
            {state.error ? (
              <Alert variant="error" title="The deadline was not extended">
                {privacyErrorMessage(state.error)}
              </Alert>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-months`} required>
                Extend by
              </Label>
              <Select id={`${id}-months`} name="months" required defaultValue="1">
                <option value="1">1 month</option>
                <option value="2">2 months</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-reason`} required>
                Reason
              </Label>
              <Select id={`${id}-reason`} name="reason" required defaultValue="complex">
                {DSR_EXTENSION_REASON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex gap-3">
              <Button type="submit" loading={pending}>
                Extend deadline
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

/** "Record notice sent": the day staff told the person about the extension (nothing is sent). */
export function DsrNoticeForm({ requestId }: { readonly requestId: string }) {
  const [state, action, pending] = useActionState(recordNotice, {} as DsrExtensionState);
  const today = brusselsDay.format(new Date());
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="requestId" value={requestId} />
      {state.error ? (
        <Alert variant="error" title="The notice was not recorded">
          {privacyErrorMessage(state.error)}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          label="Person told on"
          name="sentOn"
          type="date"
          required
          max={today}
          defaultValue={today}
        />
        <Button type="submit" variant="secondary" loading={pending}>
          Record notice sent
        </Button>
      </div>
    </form>
  );
}
