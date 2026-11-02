"use client";

import { Alert, Badge, Button, EmptyState, Label, Select, Stack, TextField } from "@igs/ui";
import { useActionState, useId } from "react";
import {
  ResponsiveTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./responsive-table";

import { type ConsentsState, consents } from "../app/privacy/actions";
import {
  CONSENT_PURPOSE_LABELS,
  CONSENT_PURPOSE_OPTIONS,
  CONSENT_SOURCE_LABELS,
  STAFF_CONSENT_SOURCE_OPTIONS,
  formatMoment,
  privacyErrorMessage,
} from "./privacy-labels";

/** The Consents page body: the lookup, the current state per purpose, the history, the form. */
export function ConsentsPanel() {
  const [state, action, pending] = useActionState(consents, {} as ConsentsState);
  const id = useId();
  const found = state.consents;

  return (
    <Stack gap={6}>
      <search>
        <form action={action} noValidate className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="intent" value="lookup" />
          <TextField
            className="w-full min-w-0 sm:min-w-64 sm:flex-1"
            label="The person's e-mail address"
            name="subjectRef"
            type="email"
            autoComplete="off"
            required
            maxLength={254}
            defaultValue={state.lookup ?? ""}
            key={`lookup-${state.lookup ?? ""}`}
            error={
              state.error === "privacy.subject_ref_invalid"
                ? privacyErrorMessage(state.error)
                : undefined
            }
          />
          <Button type="submit" variant="secondary" loading={pending}>
            Look up
          </Button>
        </form>
      </search>

      {state.error && state.error !== "privacy.subject_ref_invalid" ? (
        <Alert variant="error" title="That didn't work">
          {privacyErrorMessage(state.error)}
        </Alert>
      ) : null}
      {state.recorded ? <Alert variant="success" title="Consent change recorded" /> : null}

      {found ? (
        <>
          <section aria-labelledby={`${id}-current`} className="flex flex-col gap-3">
            <h2 id={`${id}-current`} className="font-display text-xl font-semibold">
              Current consents of <span className="break-all">{found.subjectRef}</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {found.purposes.map(({ purpose, current }) => (
                <li key={purpose} className="flex flex-wrap items-center gap-3">
                  <span className="min-w-48 font-semibold">{CONSENT_PURPOSE_LABELS[purpose]}</span>
                  {current ? (
                    <>
                      <Badge variant={current.granted ? "success" : "neutral"}>
                        {current.granted ? "Given" : "Withdrawn"}
                      </Badge>
                      <span className="text-sm text-[var(--color-text-subtle)]">
                        {formatMoment(current.at)} · {CONSENT_SOURCE_LABELS[current.source]}
                      </span>
                    </>
                  ) : (
                    <Badge variant="neutral">Never asked</Badge>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby={`${id}-record`} className="flex flex-col gap-3">
            <h2 id={`${id}-record`} className="font-display text-xl font-semibold">
              Record a change
            </h2>
            <form action={action} noValidate className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="intent" value="record" />
              <input type="hidden" name="subjectRef" value={found.subjectRef} />
              <div className="flex min-w-48 flex-col gap-1.5">
                <Label htmlFor={`${id}-purpose`} required>
                  Purpose
                </Label>
                <Select id={`${id}-purpose`} name="purpose" required>
                  {CONSENT_PURPOSE_OPTIONS.map((purpose) => (
                    <option key={purpose} value={purpose}>
                      {CONSENT_PURPOSE_LABELS[purpose]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex min-w-40 flex-col gap-1.5">
                <Label htmlFor={`${id}-granted`} required>
                  Given or withdrawn
                </Label>
                <Select id={`${id}-granted`} name="granted" required>
                  <option value="true">Given</option>
                  <option value="false">Withdrawn</option>
                </Select>
              </div>
              <div className="flex min-w-48 flex-col gap-1.5">
                <Label htmlFor={`${id}-source`} required>
                  Told us
                </Label>
                <Select id={`${id}-source`} name="source" required>
                  {STAFF_CONSENT_SOURCE_OPTIONS.map((source) => (
                    <option key={source} value={source}>
                      {CONSENT_SOURCE_LABELS[source]}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" loading={pending}>
                Record change
              </Button>
            </form>
          </section>

          <section aria-labelledby={`${id}-history`} className="flex flex-col gap-3">
            <h2 id={`${id}-history`} className="font-display text-xl font-semibold">
              History
            </h2>
            {found.history.length === 0 ? (
              <EmptyState title="No consent recorded yet" data-testid="consent-history-empty" />
            ) : (
              <ResponsiveTable>
                <caption className="sr-only">Consent history, newest first</caption>
                <TableHead>
                  <TableRow className="border-b border-[var(--color-border-strong)]">
                    <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                      When
                    </TableHeader>
                    <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                      Purpose
                    </TableHeader>
                    <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                      Consent
                    </TableHeader>
                    <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                      Source
                    </TableHeader>
                    <TableHeader scope="col" className="py-2 font-semibold">
                      Policy
                    </TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {found.history.map((event) => (
                    <TableRow key={event.id} className="border-b border-[var(--color-border)]">
                      <TableCell label="When" className="py-2 pr-4">
                        {formatMoment(event.at)}
                      </TableCell>
                      <TableCell label="Purpose" className="py-2 pr-4">
                        {CONSENT_PURPOSE_LABELS[event.purpose]}
                      </TableCell>
                      <TableCell label="Consent" className="py-2 pr-4">
                        {event.granted ? "Given" : "Withdrawn"}
                      </TableCell>
                      <TableCell label="Source" className="py-2 pr-4">
                        {CONSENT_SOURCE_LABELS[event.source]}
                      </TableCell>
                      <TableCell label="Policy" className="py-2">
                        {event.policyVersion}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ResponsiveTable>
            )}
          </section>
        </>
      ) : null}
    </Stack>
  );
}
