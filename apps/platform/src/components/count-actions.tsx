"use client";

import { Alert, Button } from "@igs/ui";
import { useActionState } from "react";

import { applyCount, discardCount } from "../app/stock/actions";
import { stockErrorMessage } from "./stock-labels";

/** Apply or discard an open count (igs-pharma#166). */
export function CountActions({
  reconciliationId,
  differing,
}: {
  readonly reconciliationId: string;
  readonly differing: number;
}) {
  const [applied, apply, applying] = useActionState(applyCount, {});
  const [discarded, discard, discarding] = useActionState(discardCount, {});
  const error = applied.error ?? discarded.error;
  return (
    <div className="flex flex-col gap-3" data-testid="count-actions">
      {error ? (
        <Alert variant="error" title="Nothing was changed">
          {stockErrorMessage(error)}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <form action={apply}>
          <input type="hidden" name="reconciliationId" value={reconciliationId} />
          <Button type="submit" loading={applying}>
            {differing === 0 ? "Confirm the count" : "Apply the count"}
          </Button>
        </form>
        <form action={discard}>
          <input type="hidden" name="reconciliationId" value={reconciliationId} />
          <Button type="submit" variant="ghost" loading={discarding}>
            Discard
          </Button>
        </form>
      </div>
    </div>
  );
}
