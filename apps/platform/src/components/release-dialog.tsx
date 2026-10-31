"use client";

import { Alert, Button, Label, Select, Stack } from "@igs/ui";
import { useActionState, useEffect, useId, useRef } from "react";

import { type ReleaseState, release } from "../app/stock/actions";
import { RELEASE_REASON_LABELS, RELEASE_REASON_OPTIONS, stockErrorMessage } from "./stock-labels";

interface Props {
  readonly productId: string;
  readonly reservationId: string;
  readonly quantity: number;
  readonly kindLabel: string;
}

/**
 * "Release" on a reservation (igs-pharma#99): gives its stock back, with a reason. There is no
 * screen that creates a reservation; the checkout does that.
 */
export function ReleaseDialog({ productId, reservationId, quantity, kindLabel }: Props) {
  const [state, action, pending] = useActionState(release, {} as ReleaseState);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  // keep the dialog open to show a refusal
  useEffect(() => {
    if (state.error && !dialog.current?.open) dialog.current?.showModal();
  }, [state]);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => dialog.current?.showModal()}>
        Release
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        className="m-auto w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 text-[var(--color-text)] shadow-lg backdrop:bg-black/50"
      >
        <form action={action}>
          <Stack gap={4}>
            <h2 id={`${id}-title`} className="font-display text-2xl font-semibold">
              Release {quantity} set aside
            </h2>
            <p className="text-[var(--color-text-subtle)]">
              {kindLabel}: the {quantity} unit{quantity === 1 ? "" : "s"} become available again.
            </p>
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="reservationId" value={reservationId} />
            {state.error ? (
              <Alert variant="error" title="Nothing was released">
                {stockErrorMessage(state.error)}
              </Alert>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-reason`} required>
                Reason
              </Label>
              <Select id={`${id}-reason`} name="reason" required defaultValue="staff_correction">
                {RELEASE_REASON_OPTIONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {RELEASE_REASON_LABELS[reason]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex gap-3">
              <Button type="submit" loading={pending}>
                Release
              </Button>
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
