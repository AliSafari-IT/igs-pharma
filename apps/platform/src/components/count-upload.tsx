"use client";

import { Alert, Button, FieldError, Label } from "@igs/ui";
import { useActionState, useId } from "react";

import { uploadCount } from "../app/stock/actions";
import { rowErrorMessage, stockErrorMessage } from "./stock-labels";

/**
 * The count file upload (igs-pharma#166): choose a `CNK;lot;expiry;counted` file and open its
 * preview, where the count is applied or discarded. A file with any problem is not stored.
 */
export function CountUpload() {
  const [state, action, pending] = useActionState(uploadCount, {});
  const id = useId();
  const problems = state.problems ?? [];

  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-64 flex-col gap-1.5">
          <Label htmlFor={`${id}-file`} required>
            Count file (CSV)
          </Label>
          <input
            id={`${id}-file`}
            name="file"
            type="file"
            accept=".csv,text/csv,text/plain"
            required
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? `${id}-file-error` : undefined}
          />
          {state.error ? (
            <FieldError id={`${id}-file-error`}>{stockErrorMessage(state.error)}</FieldError>
          ) : null}
        </div>
        <Button type="submit" variant="secondary" loading={pending}>
          Preview the count
        </Button>
      </form>
      {problems.length > 0 ? (
        <Alert variant="error" title={`${state.fileName ?? "The file"} can't be counted`}>
          <p>Fix these lines and upload the file again. Nothing was counted.</p>
          <ul className="mt-2 list-disc pl-5">
            {problems.map((e) => (
              <li key={`${e.line}-${e.code}`}>
                {e.line === 0 ? "File" : `Line ${e.line}`}: {rowErrorMessage(e.code)}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}
