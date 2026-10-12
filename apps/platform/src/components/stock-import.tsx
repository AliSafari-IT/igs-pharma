"use client";

import { Alert, Badge, Button, FieldError, Label, Stack } from "@igs/ui";
import { useActionState, useId } from "react";

import { type StockImportState, confirmImport, previewImport } from "../app/stock/actions";
import { rowErrorMessage, stockErrorMessage } from "./stock-labels";

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * The stock count upload (igs-pharma#53): choose a `CNK;quantity` file, see what it would change
 * (a dry run, nothing written), then confirm. A file with any problem cannot be confirmed: the
 * import is all or nothing.
 */
export function StockImport() {
  const [preview, previewAction, previewing] = useActionState(previewImport, {});
  const [confirmed, confirmAction, confirming] = useActionState(
    confirmImport,
    {} as StockImportState,
  );
  const id = useId();
  const plan = preview.plan;
  const changes = plan?.rows.filter((row) => row.delta !== 0) ?? [];
  const unchanged = (plan?.rows.length ?? 0) - changes.length;
  const fileError = preview.error;

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <h2 id={`${id}-title`} className="font-display text-2xl font-semibold">
        Upload a stock count
      </h2>
      <p className="text-[var(--color-text-subtle)]">
        One line per product: <code>CNK;quantity</code>, where quantity is the count on the shelf.
        You see what changes before anything is saved.
      </p>
      <form action={previewAction} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-64 flex-col gap-1.5">
          <Label htmlFor={`${id}-file`} required>
            CSV file
          </Label>
          <input
            id={`${id}-file`}
            name="file"
            type="file"
            accept=".csv,text/csv,text/plain"
            required
            aria-invalid={fileError ? true : undefined}
            aria-describedby={fileError ? `${id}-file-error` : undefined}
          />
          {fileError ? (
            <FieldError id={`${id}-file-error`}>{stockErrorMessage(fileError)}</FieldError>
          ) : null}
        </div>
        <Button type="submit" variant="secondary" loading={previewing}>
          Preview
        </Button>
      </form>

      {plan ? (
        <Stack gap={4}>
          {plan.errors.length > 0 ? (
            <Alert variant="error" title={`${preview.fileName ?? "The file"} can't be imported`}>
              <p>Fix these lines and upload the file again. No stock was changed.</p>
              <ul className="mt-2 list-disc pl-5">
                {plan.errors.map((e) => (
                  <li key={`${e.line}-${e.code}`}>
                    {e.line === 0 ? "File" : `Line ${e.line}`}: {rowErrorMessage(e.code)}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : (
            <Alert variant="info" title={`Preview of ${preview.fileName ?? "the file"}`}>
              {changes.length} product{changes.length === 1 ? "" : "s"} will change, {unchanged}{" "}
              stay{unchanged === 1 ? "s" : ""} the same.
            </Alert>
          )}

          {plan.rows.length > 0 ? (
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">What the file changes</caption>
              <thead>
                <tr className="border-b border-[var(--color-border-strong)]">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Line
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    CNK
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Name (Dutch)
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">
                    On hand now
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">
                    In the file
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row) => (
                  <tr key={row.line} className="border-b border-[var(--color-border)]">
                    <td className="py-2 pr-4">{row.line}</td>
                    <td className="py-2 pr-4">
                      <code>{row.cnk}</code>
                    </td>
                    <td className="py-2 pr-4">{row.nameNl ?? "—"}</td>
                    <td className="py-2 pr-4 text-right">{row.onHand}</td>
                    <td className="py-2 pr-4 text-right">{row.target}</td>
                    <td className="py-2 text-right">
                      {row.delta === 0 ? (
                        <span className="text-[var(--color-text-subtle)]">No change</span>
                      ) : (
                        <Badge variant={row.delta > 0 ? "success" : "amber"}>
                          {signed(row.delta)}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {plan.errors.length === 0 ? (
            <form action={confirmAction} className="flex flex-col gap-3">
              <input type="hidden" name="csv" value={preview.csv ?? ""} />
              {confirmed.error ? (
                <Alert variant="error" title="The stock was not imported">
                  {stockErrorMessage(confirmed.error)}
                </Alert>
              ) : null}
              <div>
                <Button type="submit" loading={confirming}>
                  Confirm import
                </Button>
              </div>
            </form>
          ) : null}
        </Stack>
      ) : null}
    </section>
  );
}
