"use client";

import { Alert } from "@igs/ui";

export interface SummaryItem {
  /** The id of the field the message belongs to; the link moves focus there. */
  readonly fieldId: string;
  readonly message: string;
}

interface Props {
  readonly title: string;
  readonly items: readonly SummaryItem[];
}

/**
 * The error summary above a form (igs-pharma#115): an `Alert` (role="alert", so it is read out as
 * soon as it appears) listing each field's message as a link to that field. The same messages sit
 * under the fields, tied to them with aria-describedby.
 */
export function ErrorSummary({ title, items }: Props) {
  if (items.length === 0) return null;
  return (
    <Alert variant="error" title={title} data-testid="error-summary">
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.fieldId}>
            <a href={`#${item.fieldId}`} className="underline underline-offset-2">
              {item.message}
            </a>
          </li>
        ))}
      </ul>
    </Alert>
  );
}
