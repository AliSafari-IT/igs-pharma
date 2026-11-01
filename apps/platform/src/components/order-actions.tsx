"use client";

import type { FulfilmentStep } from "@igs/module-orders";
import { Alert, Button, Label, Select, Stack, Textarea } from "@igs/ui";
import { useActionState, useId } from "react";

import {
  type OrderActionState,
  advance,
  cancelNotSellable,
  cancelStockShort,
  decide,
  reReserve,
  refund,
  retryLabel,
} from "../app/orders/actions";
import {
  REFUND_REASON_LABELS,
  REFUND_REASON_OPTIONS,
  STEP_ACTION_LABELS,
  orderErrorMessage,
} from "./order-labels";

interface OrderRef {
  readonly orderId: string;
  readonly version: number;
}

/** Approve or reject an order in pharmacist review; the note is optional and staff-only. */
export function ReviewForm({
  orderId,
  version,
  blocked = false,
}: OrderRef & { readonly blocked?: boolean }) {
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
          <Button
            type="submit"
            name="decision"
            value="approved"
            loading={pending}
            disabled={blocked}
          >
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

/** One next fulfilment step (`secondary` for the less usual one, e.g. a parcel that came back). */
export function StepForm({
  orderId,
  version,
  to,
  secondary = false,
}: OrderRef & { readonly to: FulfilmentStep; readonly secondary?: boolean }) {
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
          <Button
            type="submit"
            loading={pending}
            variant={secondary ? "secondary" : "primary"}
            data-step={to}
          >
            {STEP_ACTION_LABELS[to]}
          </Button>
        </div>
      </Stack>
    </form>
  );
}

/** Asks Sendcloud again for a label it refused (igs-pharma#202). */
export function RetryLabelForm({ orderId }: { readonly orderId: string }) {
  const [state, action, pending] = useActionState(retryLabel, {} as OrderActionState);
  return (
    <form action={action} data-testid="retry-label-form">
      <Stack gap={3}>
        <input type="hidden" name="orderId" value={orderId} />
        {state.error ? (
          <Alert variant="error" title="Nothing was asked">
            {orderErrorMessage(state.error)}
          </Alert>
        ) : null}
        <div>
          <Button type="submit" variant="secondary" loading={pending}>
            Try the label again
          </Button>
        </div>
      </Stack>
    </form>
  );
}

/** Asks for the full refund of a closed, paid order; the note is optional and staff-only. */
export function RefundForm({ orderId }: { readonly orderId: string }) {
  const [state, action, pending] = useActionState(refund, {} as OrderActionState);
  const id = useId();
  return (
    <form action={action} data-testid="refund-form">
      <Stack gap={3}>
        <input type="hidden" name="orderId" value={orderId} />
        {state.error ? (
          <Alert variant="error" title="Nothing was recorded">
            {orderErrorMessage(state.error)}
          </Alert>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-reason`} required>
            Reason
          </Label>
          <Select id={`${id}-reason`} name="reason" required>
            {REFUND_REASON_OPTIONS.map((reason) => (
              <option key={reason} value={reason}>
                {REFUND_REASON_LABELS[reason]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-note`}>Note (staff only, optional)</Label>
          <Textarea id={`${id}-note`} name="note" maxLength={500} rows={3} />
        </div>
        <div>
          <Button type="submit" variant="danger" loading={pending}>
            Refund the full amount
          </Button>
        </div>
      </Stack>
    </form>
  );
}

/** A stock-short order: hold the same products again (all or nothing). */
export function ReReserveForm({ orderId, version }: OrderRef) {
  const [state, action, pending] = useActionState(reReserve, {} as OrderActionState);
  return (
    <form action={action} data-testid="re-reserve-form">
      <Stack gap={3}>
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="expectedVersion" value={version} />
        {state.error ? (
          <Alert variant="error" title="Nothing was reserved">
            {orderErrorMessage(state.error)}
          </Alert>
        ) : null}
        <div>
          <Button type="submit" loading={pending}>
            Reserve the stock again
          </Button>
        </div>
      </Stack>
    </form>
  );
}

/** A stock-short order that cannot be filled: cancel it and refund the full amount. */
export function CancelStockShortForm({ orderId, version }: OrderRef) {
  return <CancelForm orderId={orderId} version={version} kind="stock-short" />;
}

/** An order with a product that is no longer sellable: cancel it and refund the full amount. */
export function CancelNotSellableForm({ orderId, version }: OrderRef) {
  return <CancelForm orderId={orderId} version={version} kind="not-sellable" />;
}

function CancelForm({
  orderId,
  version,
  kind,
}: OrderRef & { readonly kind: "stock-short" | "not-sellable" }) {
  const [state, action, pending] = useActionState(
    kind === "stock-short" ? cancelStockShort : cancelNotSellable,
    {} as OrderActionState,
  );
  const id = useId();
  return (
    <form action={action} data-testid={`cancel-${kind}-form`}>
      <Stack gap={3}>
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="expectedVersion" value={version} />
        {state.error ? (
          <Alert variant="error" title="Nothing was changed">
            {orderErrorMessage(state.error)}
          </Alert>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-note`}>Note (staff only, optional)</Label>
          <Textarea id={`${id}-note`} name="note" maxLength={500} rows={3} />
        </div>
        <div>
          <Button type="submit" variant="danger" loading={pending}>
            Cancel and refund
          </Button>
        </div>
      </Stack>
    </form>
  );
}
