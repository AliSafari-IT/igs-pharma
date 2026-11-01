"use client";

import { authClient } from "@igs/auth/client";
import { Alert, Button, Stack, TextField } from "@igs/ui";
import { useActionState, useEffect, useRef, useState } from "react";

import { type DeliverySettingsState, saveDeliverySettings } from "../app/settings/delivery/actions";
import { authErrorMessage } from "./auth-errors";
import { deliveryErrorMessage } from "./delivery-labels";

interface Props {
  /** The price now in force, as staff type it ("4.95"). */
  readonly price: string;
  /** The free-delivery value now in force ("49.00"), or "" when delivery is never free. */
  readonly freeFrom: string;
  /** The version of the settings the form was opened on (0: still the defaults). */
  readonly version: number;
}

/**
 * The delivery price and the free-delivery value (igs-pharma#202). When the server answers that the
 * person's passkey check is older than 10 minutes, the form asks for the passkey and then submits
 * the SAME form again (the same submission id, so it saves once); cancelling the prompt saves nothing.
 */
export function DeliverySettingsForm({
  price: savedPrice,
  freeFrom: savedFreeFrom,
  version,
}: Props) {
  const [state, action, pending] = useActionState(
    saveDeliverySettings,
    {} as DeliverySettingsState,
  );
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  // controlled on purpose: React resets an uncontrolled form once its action finishes, and the retry
  // after the passkey check must repeat exactly what was typed
  const [price, setPrice] = useState(savedPrice);
  const [freeFrom, setFreeFrom] = useState(savedFreeFrom);
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const needsFreshProof = state.error === "identity.fresh_mfa_required";

  useEffect(() => {
    if (state.done) setSubmissionId(crypto.randomUUID());
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

  return (
    <form ref={form} action={action} data-testid="delivery-form">
      <Stack gap={4}>
        <input type="hidden" name="submissionId" value={submissionId} />
        <input type="hidden" name="expectedVersion" value={version} />
        <TextField
          label="Delivery price (euros, VAT included)"
          name="price"
          inputMode="decimal"
          autoComplete="off"
          required
          hint="For example 4.95. From 0 to 50.00."
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
        <TextField
          label="Free delivery from an order value of (euros, VAT included)"
          name="freeFrom"
          inputMode="decimal"
          autoComplete="off"
          hint="For example 49.00. Leave it empty if delivery is never free. An order of exactly this value is free."
          value={freeFrom}
          onChange={(event) => setFreeFrom(event.target.value)}
        />
        {needsFreshProof ? (
          <Alert variant="info" title="Confirm it's you first">
            For this change your own passkey must have confirmed it's you in the last 10 minutes.
          </Alert>
        ) : state.error ? (
          <Alert variant="error" title="That was not saved">
            {deliveryErrorMessage(state.error)}
          </Alert>
        ) : state.done ? (
          <Alert variant="success" title="Saved">
            New orders use these amounts straight away.
          </Alert>
        ) : null}
        {confirmError ? (
          <Alert variant="error" title="That didn't work">
            {confirmError}
          </Alert>
        ) : null}
        <div>
          {needsFreshProof ? (
            <Button type="button" onClick={confirmAndRetry} loading={pending}>
              Confirm with your passkey
            </Button>
          ) : (
            <Button type="submit" loading={pending}>
              Save
            </Button>
          )}
        </div>
      </Stack>
    </form>
  );
}
