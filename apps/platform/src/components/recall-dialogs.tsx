"use client";

import { Label, Select, Textarea } from "@igs/ui";
import { useId, useState } from "react";

import { endRecallAction, startRecallAction } from "../app/recalls/actions";
import { LotDialog } from "./lot-dialogs";
import { RECALL_NOTE_LIMIT, RECALL_SOURCE_LABELS, RECALL_SOURCE_OPTIONS } from "./stock-labels";

/** The recall dialogs (igs-pharma#187): start one on a product, end one. Pharmacists only. */

/**
 * Starts a recall on this product: every lot (the default) or the lots ticked. The lots are
 * quarantined and the product stops selling at once.
 */
export function StartRecallDialog({
  productId,
  lots,
}: {
  readonly productId: string;
  readonly lots: readonly { readonly lotId: string; readonly label: string }[];
}) {
  const id = useId();
  const [scope, setScope] = useState<"all_lots" | "lots">("all_lots");
  return (
    <LotDialog
      action={startRecallAction}
      open="Start a recall"
      title="Start a recall"
      intro="The lots go into quarantine and the product stops selling at once: it leaves the webshop, and orders holding it can't be paid, approved or packed. Only a pharmacist ends the recall."
      submit="Start the recall"
      hidden={{ productId }}
      testId="recall-open"
      variant="ghost"
    >
      {(value) => (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">Which lots</legend>
            <label className="flex min-h-[36px] items-center gap-2">
              <input
                type="radio"
                name="scope"
                value="all_lots"
                checked={scope === "all_lots"}
                onChange={() => setScope("all_lots")}
                className="size-5 accent-[var(--color-primary)]"
              />
              Every lot
            </label>
            <label className="flex min-h-[36px] items-center gap-2">
              <input
                type="radio"
                name="scope"
                value="lots"
                checked={scope === "lots"}
                onChange={() => setScope("lots")}
                disabled={lots.length === 0}
                className="size-5 accent-[var(--color-primary)]"
              />
              Only the lots I choose
            </label>
          </fieldset>
          {scope === "lots" ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-medium">Lots</legend>
              {lots.map((lot) => (
                <label key={lot.lotId} className="flex min-h-[36px] items-center gap-2">
                  <input
                    type="checkbox"
                    name="lotId"
                    value={lot.lotId}
                    className="size-5 accent-[var(--color-primary)]"
                  />
                  {lot.label}
                </label>
              ))}
            </fieldset>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-source`} required>
              Called by
            </Label>
            <Select
              id={`${id}-source`}
              name="source"
              required
              defaultValue={value("source", "famhp")}
              key={`source-${value("source")}`}
            >
              {RECALL_SOURCE_OPTIONS.map((source) => (
                <option key={source} value={source}>
                  {RECALL_SOURCE_LABELS[source]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-note`} required>
              Reference and reason
            </Label>
            <Textarea
              id={`${id}-note`}
              name="note"
              required
              maxLength={RECALL_NOTE_LIMIT}
              rows={3}
              placeholder="For example: FAMHP notice 2026-123, contamination of batch A1"
              defaultValue={value("note")}
              key={`note-${value("note")}`}
            />
          </div>
        </>
      )}
    </LotDialog>
  );
}

/** Ends an active recall: the product may sell again, its lots stay in quarantine. */
export function EndRecallDialog({ recallId }: { readonly recallId: string }) {
  return (
    <LotDialog
      action={endRecallAction}
      open="End the recall"
      title="End the recall"
      intro="The product may sell again. Its recalled lots stay in quarantine: release or dispose of them separately."
      submit="End the recall"
      hidden={{ recallId }}
      testId="recall-end-open"
      variant="secondary"
    >
      {() => null}
    </LotDialog>
  );
}
