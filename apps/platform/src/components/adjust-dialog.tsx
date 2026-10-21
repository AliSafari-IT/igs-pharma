"use client";

import { Alert, Button, FieldError, Label, Select, Stack, TextField, Textarea } from "@igs/ui";
import { useActionState, useEffect, useId, useRef } from "react";

import { type AdjustState, adjust } from "../app/stock/actions";
import { ADJUST_REASON_OPTIONS, REASON_LABELS, stockErrorMessage } from "./stock-labels";

interface Props {
  readonly productId: string;
  readonly onHand: number;
  /** The product's lots to choose from (igs-pharma#164), labelled. */
  readonly lots: readonly { readonly lotId: string; readonly label: string }[];
  /** A medicine always names its lot; another product may use its untracked stock. */
  readonly isMedicine: boolean;
}

/**
 * The Adjust dialog on a product's stock page (igs-pharma#53): the lot (igs-pharma#164), a signed
 * change, a reason and a note, all required. The ledger refuses a change that would take the lot
 * below zero.
 */
export function AdjustDialog({ productId, onHand, lots, isMedicine }: Props) {
  const [state, action, pending] = useActionState(adjust, {} as AdjustState);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const value = (name: string, fallback = "") => state.values?.[name] ?? fallback;
  const noteError = state.error === "kernel.validation_failed" && !value("note").trim();

  // keep the dialog open to show a refusal
  useEffect(() => {
    if (state.error && !dialog.current?.open) dialog.current?.showModal();
  }, [state]);

  return (
    <>
      <Button variant="secondary" onClick={() => dialog.current?.showModal()}>
        Adjust stock
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        className="m-auto w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 text-[var(--color-text)] shadow-lg backdrop:bg-[var(--color-text)]/40"
      >
        <form action={action} noValidate>
          <Stack gap={4}>
            <h2 id={`${id}-title`} className="font-display text-2xl font-semibold">
              Adjust stock
            </h2>
            <p className="text-[var(--color-text-subtle)]">On hand now: {onHand}</p>
            <input type="hidden" name="productId" value={productId} />
            {state.error ? (
              <Alert variant="error" title="The stock was not changed">
                {stockErrorMessage(state.error)}
                {state.error === "inventory.negative_stock" && state.onHand !== undefined
                  ? ` There are ${state.onHand} on hand.`
                  : null}
              </Alert>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-lot`} required>
                Lot
              </Label>
              <Select
                id={`${id}-lot`}
                name="lotId"
                required
                defaultValue={value("lotId", isMedicine ? (lots[0]?.lotId ?? "") : "")}
                key={`lot-${value("lotId")}`}
              >
                {isMedicine ? null : <option value="">No lot</option>}
                {lots.map((lot) => (
                  <option key={lot.lotId} value={lot.lotId}>
                    {lot.label}
                  </option>
                ))}
              </Select>
            </div>
            <TextField
              label="Change"
              name="delta"
              inputMode="numeric"
              autoComplete="off"
              required
              hint="For example -2 for two broken boxes, or 5 for five found"
              defaultValue={value("delta")}
              key={`delta-${value("delta")}`}
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-reason`} required>
                Reason
              </Label>
              <Select
                id={`${id}-reason`}
                name="reason"
                required
                defaultValue={value("reason", "adjustment")}
                key={`reason-${value("reason")}`}
              >
                {ADJUST_REASON_OPTIONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {REASON_LABELS[reason]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-note`} required>
                Note
              </Label>
              <Textarea
                id={`${id}-note`}
                name="note"
                required
                maxLength={200}
                rows={3}
                defaultValue={value("note")}
                key={`note-${value("note")}`}
                invalid={noteError}
                aria-describedby={noteError ? `${id}-note-error` : undefined}
              />
              {noteError ? (
                <FieldError id={`${id}-note-error`}>Say why the stock changes.</FieldError>
              ) : null}
            </div>
            <div className="flex gap-3">
              <Button type="submit" loading={pending}>
                Save change
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
