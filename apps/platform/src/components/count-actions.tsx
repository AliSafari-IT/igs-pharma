"use client";

import { Alert, Button } from "@igs/ui";
import { useActionState } from "react";

import { type CountActionState, applyCount, discardCount } from "../app/stock/actions";
import { stockErrorMessage } from "./stock-labels";

async function chooseCount(previous: CountActionState, form: FormData): Promise<CountActionState> {
  if (form.get("decision") === "apply") return applyCount(previous, form);
  if (form.get("decision") === "discard") return discardCount(previous, form);
  return { error: "kernel.validation_failed" };
}

/** Apply or discard an open count (igs-pharma#166). */
export function CountActions({
  reconciliationId,
  differing,
}: {
  readonly reconciliationId: string;
  readonly differing: number;
}) {
  const [state, action, pending] = useActionState(chooseCount, {});
  return (
    <div className="flex flex-col gap-3" data-testid="count-actions">
      {!pending && state.error ? (
        <Alert variant="error" title="Nothing was changed">
          {stockErrorMessage(state.error)}
        </Alert>
      ) : null}
      {pending ? <output>Saving your choice…</output> : null}
      <form action={action} aria-busy={pending} className="flex flex-wrap gap-3">
        <input type="hidden" name="reconciliationId" value={reconciliationId} />
        <Button type="submit" name="decision" value="apply" disabled={pending}>
          {differing === 0 ? "Confirm the count" : "Apply the count"}
        </Button>
        <Button type="submit" name="decision" value="discard" variant="ghost" disabled={pending}>
          Discard
        </Button>
      </form>
    </div>
  );
}
