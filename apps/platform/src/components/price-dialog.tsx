"use client";

import { Alert, Button, Input, Label, Stack, TextField } from "@igs/ui";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { type PriceFormState, changePrice } from "../app/products/actions";
import { formatEuros, priceErrorMessage, toBrusselsLocal } from "./price-labels";

interface Props {
  readonly productId: string;
  /** The current price in cents, `null` when the product has none yet. */
  readonly currentCents: number | null;
}

/**
 * The Change price dialog on the product page (igs-pharma#59): a price in euros, VAT included
 * (stored as whole cents), from now or from a date and time (Brussels), and an optional reason.
 */
export function PriceDialog({ productId, currentCents }: Props) {
  const [state, action, pending] = useActionState(changePrice, {} as PriceFormState);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const value = (name: string, fallback = "") => state.values?.[name] ?? fallback;
  const [when, setWhen] = useState(value("when", "now"));
  const [min, setMin] = useState("");

  // keep the dialog open to show a refusal
  useEffect(() => {
    if (state.error && !dialog.current?.open) dialog.current?.showModal();
    if (state.values?.["when"]) setWhen(state.values["when"]);
  }, [state]);

  const open = () => {
    setMin(toBrusselsLocal(new Date()));
    dialog.current?.showModal();
  };

  return (
    <>
      <Button variant="secondary" onClick={open}>
        Change price
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        className="m-auto w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 text-[var(--color-text)] shadow-lg backdrop:bg-[var(--color-text)]/40"
      >
        <form action={action} noValidate>
          <Stack gap={4}>
            <h2 id={`${id}-title`} className="font-display text-2xl font-semibold">
              Change price
            </h2>
            <p className="text-[var(--color-text-subtle)]">
              {currentCents === null ? "No price yet." : `Price now: ${formatEuros(currentCents)}`}
            </p>
            <input type="hidden" name="productId" value={productId} />
            {state.error ? (
              <Alert variant="error" title="The price was not changed">
                {priceErrorMessage(state.error)}
              </Alert>
            ) : null}
            <TextField
              label="New price in euros, VAT included"
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              required
              hint="For example 5.99"
              defaultValue={value("amount")}
              key={`amount-${value("amount")}`}
            />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-medium">Starts</legend>
              <label className="flex min-h-[36px] items-center gap-2">
                <input
                  type="radio"
                  name="when"
                  value="now"
                  checked={when === "now"}
                  onChange={() => setWhen("now")}
                  className="size-5 accent-[var(--color-primary)]"
                />
                From now
              </label>
              <label className="flex min-h-[36px] items-center gap-2">
                <input
                  type="radio"
                  name="when"
                  value="later"
                  checked={when === "later"}
                  onChange={() => setWhen("later")}
                  className="size-5 accent-[var(--color-primary)]"
                />
                From a date and time
              </label>
            </fieldset>
            {when === "later" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-valid-from`} required>
                  Date and time (Brussels)
                </Label>
                <Input
                  id={`${id}-valid-from`}
                  name="validFrom"
                  type="datetime-local"
                  required
                  min={min || undefined}
                  defaultValue={value("validFrom")}
                  key={`valid-from-${value("validFrom")}`}
                />
              </div>
            ) : null}
            <TextField
              label="Reason (optional)"
              name="reason"
              maxLength={200}
              autoComplete="off"
              hint="For example: new supplier price"
              defaultValue={value("reason")}
              key={`reason-${value("reason")}`}
            />
            <div className="flex gap-3">
              <Button type="submit" loading={pending}>
                Save price
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
