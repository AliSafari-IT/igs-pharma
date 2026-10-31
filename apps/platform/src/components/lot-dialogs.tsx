"use client";

import { Alert, Button, Label, Select, Stack, TextField, Textarea } from "@igs/ui";
import { type ReactNode, useActionState, useEffect, useId, useRef } from "react";

import {
  type LotActionState,
  assignLot,
  countLots,
  expiryBuffer,
  quarantine,
  receive,
  releaseFromQuarantine,
  returnLot,
} from "../app/stock/actions";
import { QUARANTINE_LABELS, QUARANTINE_REASON_OPTIONS, stockErrorMessage } from "./stock-labels";

/** The lot dialogs and buttons on a product's stock page (igs-pharma#164). */

export type Action = (previous: LotActionState, form: FormData) => Promise<LotActionState>;

export function LotDialog({
  action,
  open,
  title,
  intro,
  submit,
  hidden,
  testId,
  variant = "secondary",
  children,
}: {
  readonly action: Action;
  readonly open: string;
  readonly title: string;
  readonly intro?: ReactNode;
  readonly submit: string;
  readonly hidden: Readonly<Record<string, string>>;
  readonly testId: string;
  readonly variant?: "primary" | "secondary" | "ghost";
  readonly children: (value: (name: string, fallback?: string) => string) => ReactNode;
}) {
  const [state, run, pending] = useActionState(action, {} as LotActionState);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const value = (name: string, fallback = "") => state.values?.[name] ?? fallback;
  // keep the dialog open to show a refusal
  useEffect(() => {
    if (state.error && !dialog.current?.open) dialog.current?.showModal();
  }, [state]);
  return (
    <>
      <Button variant={variant} onClick={() => dialog.current?.showModal()} data-testid={testId}>
        {open}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        className="m-auto w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 text-[var(--color-text)] shadow-lg backdrop:bg-[var(--color-text)]/40"
      >
        <form action={run} noValidate>
          <Stack gap={4}>
            <h2 id={`${id}-title`} className="font-display text-2xl font-semibold">
              {title}
            </h2>
            {intro ? <p className="text-[var(--color-text-subtle)]">{intro}</p> : null}
            {Object.entries(hidden).map(([name, v]) => (
              <input key={name} type="hidden" name={name} value={v} />
            ))}
            {state.error ? (
              <Alert variant="error" title="Nothing was changed">
                {stockErrorMessage(state.error)}
              </Alert>
            ) : null}
            {children(value)}
            <div className="flex gap-3">
              <Button type="submit" loading={pending}>
                {submit}
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

function NoteField({ value }: { readonly value: (name: string) => string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Note (optional)</Label>
      <Textarea
        id={id}
        name="note"
        maxLength={200}
        rows={2}
        defaultValue={value("note")}
        key={`note-${value("note")}`}
      />
    </div>
  );
}

/** Stock taken from the pharmacy into the web pool: a medicine needs its lot and expiry date. */
export function ReceiveDialog({
  productId,
  isMedicine,
}: {
  readonly productId: string;
  readonly isMedicine: boolean;
}) {
  return (
    <LotDialog
      action={receive}
      open="Receive stock"
      title="Receive stock"
      intro={
        isMedicine
          ? "A medicine is always received with its lot number and expiry date, as printed on the pack."
          : "The lot number and expiry date are optional for this product."
      }
      submit="Receive"
      hidden={{ productId }}
      testId="receive-open"
      variant="primary"
    >
      {(value) => (
        <>
          <TextField
            label="Quantity"
            name="quantity"
            inputMode="numeric"
            autoComplete="off"
            required
            defaultValue={value("quantity")}
            key={`quantity-${value("quantity")}`}
          />
          <TextField
            label={isMedicine ? "Lot number" : "Lot number (optional)"}
            name="lotNumber"
            autoComplete="off"
            required={isMedicine}
            maxLength={40}
            defaultValue={value("lotNumber")}
            key={`lot-${value("lotNumber")}`}
          />
          <TextField
            label={isMedicine ? "Expiry date" : "Expiry date (optional)"}
            name="expiryDate"
            type="date"
            required={isMedicine}
            defaultValue={value("expiryDate")}
            key={`expiry-${value("expiryDate")}`}
          />
          <NoteField value={value} />
        </>
      )}
    </LotDialog>
  );
}

/** Stock of one lot given back to the pharmacy. */
export function ReturnDialog({
  productId,
  lotId,
  lotName,
  onHand,
}: {
  readonly productId: string;
  readonly lotId: string;
  readonly lotName: string;
  readonly onHand: number;
}) {
  return (
    <LotDialog
      action={returnLot}
      open="Return"
      title={`Return stock of ${lotName}`}
      intro={`${onHand} on hand in this lot.`}
      submit="Return to the pharmacy"
      hidden={{ productId, lotId }}
      testId="return-open"
      variant="ghost"
    >
      {(value) => (
        <>
          <TextField
            label="Quantity"
            name="quantity"
            inputMode="numeric"
            autoComplete="off"
            required
            defaultValue={value("quantity")}
            key={`quantity-${value("quantity")}`}
          />
          <NoteField value={value} />
        </>
      )}
    </LotDialog>
  );
}

/** Stock from before lots: record the lot (and for a medicine its expiry date) it really is. */
export function AssignLotDialog({
  productId,
  onHand,
  isMedicine,
}: {
  readonly productId: string;
  readonly onHand: number;
  readonly isMedicine: boolean;
}) {
  return (
    <LotDialog
      action={assignLot}
      open="Record lot"
      title="Record the lot"
      intro={`${onHand} on hand without a recorded lot. Read the lot number${isMedicine ? " and expiry date" : ""} on the packs; repeat for each lot.`}
      submit="Record"
      hidden={{ productId }}
      testId="assign-open"
      variant="ghost"
    >
      {(value) => (
        <>
          <TextField
            label="Quantity in this lot"
            name="quantity"
            inputMode="numeric"
            autoComplete="off"
            required
            defaultValue={value("quantity")}
            key={`quantity-${value("quantity")}`}
          />
          <TextField
            label="Lot number"
            name="lotNumber"
            autoComplete="off"
            required
            maxLength={40}
            defaultValue={value("lotNumber")}
            key={`lot-${value("lotNumber")}`}
          />
          <TextField
            label={isMedicine ? "Expiry date" : "Expiry date (optional)"}
            name="expiryDate"
            type="date"
            required={isMedicine}
            defaultValue={value("expiryDate")}
            key={`expiry-${value("expiryDate")}`}
          />
        </>
      )}
    </LotDialog>
  );
}

/**
 * Count this product's lots (igs-pharma#166): the count of each lot that was counted. Nothing
 * changes yet: the count opens as a preview, to apply or discard.
 */
export function CountLotsDialog({
  productId,
  lots,
}: {
  readonly productId: string;
  readonly lots: readonly {
    readonly lotId: string;
    readonly label: string;
    readonly onHand: number;
  }[];
}) {
  return (
    <LotDialog
      action={countLots}
      open="Count"
      title="Count the lots"
      intro="Enter what is in the web stock for each lot you counted; leave a lot empty to skip it. You see the differences before anything changes."
      submit="Preview the count"
      hidden={{ productId }}
      testId="count-open"
    >
      {(value) => (
        <>
          {lots.map((lot) => (
            <TextField
              key={`${lot.lotId}-${value(`count.${lot.lotId}`)}`}
              label={`${lot.label} (${lot.onHand} in stock)`}
              name={`count.${lot.lotId}`}
              inputMode="numeric"
              autoComplete="off"
              defaultValue={value(`count.${lot.lotId}`)}
            />
          ))}
        </>
      )}
    </LotDialog>
  );
}

/** Take a lot out of sale, with a reason (pharmacist). */
export function QuarantineDialog({
  productId,
  lotId,
  lotName,
}: {
  readonly productId: string;
  readonly lotId: string;
  readonly lotName: string;
}) {
  const id = useId();
  return (
    <LotDialog
      action={quarantine}
      open="Quarantine"
      title={`Quarantine ${lotName}`}
      intro="Its stock stays on hand but can't be sold or picked until a pharmacist releases it."
      submit="Quarantine"
      hidden={{ productId, lotId }}
      testId="quarantine-open"
      variant="ghost"
    >
      {(value) => (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id} required>
            Reason
          </Label>
          <Select
            id={id}
            name="reason"
            required
            defaultValue={value("reason", "quality")}
            key={`reason-${value("reason")}`}
          >
            {QUARANTINE_REASON_OPTIONS.map((reason) => (
              <option key={reason} value={reason}>
                {QUARANTINE_LABELS[reason]}
              </option>
            ))}
          </Select>
        </div>
      )}
    </LotDialog>
  );
}

/** Put a quarantined lot back on sale (pharmacist). */
export function ReleaseLotButton({
  productId,
  lotId,
}: {
  readonly productId: string;
  readonly lotId: string;
}) {
  const [state, run, pending] = useActionState(releaseFromQuarantine, {} as LotActionState);
  return (
    <form action={run} className="inline-flex flex-col gap-1">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="lotId" value={lotId} />
      <Button type="submit" variant="ghost" loading={pending} data-testid="release-lot">
        Release
      </Button>
      {state.error ? (
        <span className="text-sm text-[var(--color-error-text)]">
          {stockErrorMessage(state.error)}
        </span>
      ) : null}
    </form>
  );
}

/** The shop-wide expiry buffer (titular only). */
export function ExpiryBufferForm({ days }: { readonly days: number }) {
  const [state, run, pending] = useActionState(expiryBuffer, {} as LotActionState);
  return (
    <form action={run} className="flex flex-wrap items-end gap-3" data-testid="expiry-buffer">
      <TextField
        label="Stop selling a lot this many days before it expires"
        name="days"
        inputMode="numeric"
        autoComplete="off"
        required
        defaultValue={state.values?.["days"] ?? String(days)}
        key={`days-${state.values?.["days"] ?? days}`}
      />
      <Button type="submit" variant="secondary" loading={pending}>
        Save
      </Button>
      {state.error ? (
        <span className="text-sm text-[var(--color-error-text)]">
          {stockErrorMessage(state.error)}
        </span>
      ) : null}
    </form>
  );
}
