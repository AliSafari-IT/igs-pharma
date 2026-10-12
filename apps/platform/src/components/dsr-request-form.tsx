"use client";

import { Alert, Button, Label, Select, Stack, TextField, Textarea } from "@igs/ui";
import { useActionState, useId } from "react";

import { type DsrFormState, createRequest } from "../app/privacy/actions";
import {
  DSR_CHANNEL_LABELS,
  DSR_CHANNEL_OPTIONS,
  DSR_TYPE_LABELS,
  DSR_TYPE_OPTIONS,
  privacyErrorMessage,
} from "./privacy-labels";

interface Props {
  /** Today in Brussels (YYYY-MM-DD): the default and the latest allowed receipt date. */
  readonly today: string;
}

/** The New request form (igs-pharma#58). */
export function DsrRequestForm({ today }: Props) {
  const [state, action, pending] = useActionState(createRequest, {} as DsrFormState);
  const id = useId();
  const value = (name: string, fallback = "") => state.values?.[name] ?? fallback;
  const fieldError = (code: string) =>
    state.error === code ? privacyErrorMessage(code) : undefined;

  return (
    <form action={action} noValidate>
      <Stack gap={6}>
        {state.error ? (
          <Alert variant="error" title="The request was not saved">
            {privacyErrorMessage(state.error)}
          </Alert>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-type`} required>
            Type of request
          </Label>
          <Select
            id={`${id}-type`}
            name="type"
            required
            defaultValue={value("type", "access")}
            key={`type-${value("type")}`}
          >
            {DSR_TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {DSR_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </div>
        <TextField
          label="The person's e-mail address"
          name="subjectRef"
          type="email"
          autoComplete="off"
          required
          maxLength={254}
          defaultValue={value("subjectRef")}
          key={`subject-${value("subjectRef")}`}
          error={fieldError("privacy.subject_ref_invalid")}
        />
        <TextField
          label="Received on"
          name="receivedOn"
          type="date"
          required
          max={today}
          defaultValue={value("receivedOn", today)}
          key={`received-${value("receivedOn")}`}
          error={fieldError("privacy.received_at_invalid")}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-channel`} required>
            Received by
          </Label>
          <Select
            id={`${id}-channel`}
            name="channel"
            required
            defaultValue={value("channel", "email")}
            key={`channel-${value("channel")}`}
          >
            {DSR_CHANNEL_OPTIONS.map((channel) => (
              <option key={channel} value={channel}>
                {DSR_CHANNEL_LABELS[channel]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-note`}>Note</Label>
          <Textarea
            id={`${id}-note`}
            name="note"
            maxLength={1000}
            rows={3}
            defaultValue={value("note")}
            key={`note-${value("note")}`}
          />
        </div>
        <div>
          <Button type="submit" loading={pending}>
            Log request
          </Button>
        </div>
      </Stack>
    </form>
  );
}
