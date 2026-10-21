"use client";

import type { FulfilmentStep } from "@igs/module-orders";
import { Alert, Button, Label, Stack, Textarea } from "@igs/ui";
import { useActionState, useId } from "react";

import { type OrderActionState, advance, decide } from "../app/orders/actions";
import { STEP_ACTION_LABELS, orderErrorMessage } from "./order-labels";

interface OrderRef {
  readonly orderId: string;
  readonly version: number;
}

/** Approve or reject an order in pharmacist review; the note is optional and staff-only. */
export function ReviewForm({ orderId, version }: OrderRef) {
  const [state, action, pending] = useActionState(decide, {} as OrderActionState);
  const id = useId();
  return (
    <form action={action} data-testid="review-form">
      <Stack gap={3}>
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="expectedVersion" value={version} />
        {state.error ? (
          <Alert variant="error" title="Nothing was recorded">
            {orderErrorMessage(state.error)}
          </Alert>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-note`}>Note (staff only, optional)</Label>
          <Textarea id={`${id}-note`} name="note" maxLength={500} rows={3} />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" name="decision" value="approved" loading={pending}>
            Approve
          </Button>
          <Button
            type="submit"
            name="decision"
            value="rejected"
            variant="danger"
            disabled={pending}
          >
            Reject and cancel
          </Button>
        </div>
      </Stack>
    </form>
  );
}

/** The one next fulfilment step. */
export function StepForm({ orderId, version, to }: OrderRef & { readonly to: FulfilmentStep }) {
  const [state, action, pending] = useActionState(advance, {} as OrderActionState);
  return (
    <form action={action} data-testid="step-form">
      <Stack gap={3}>
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="expectedVersion" value={version} />
        <input type="hidden" name="to" value={to} />
        {state.error ? (
          <Alert variant="error" title="The order didn't move">
            {orderErrorMessage(state.error)}
          </Alert>
        ) : null}
        <div>
          <Button type="submit" loading={pending}>
            {STEP_ACTION_LABELS[to]}
          </Button>
        </div>
      </Stack>
    </form>
  );
}
