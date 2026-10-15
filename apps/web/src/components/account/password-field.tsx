"use client";

import { Button, FieldError, Input, Label } from "@igs/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";

interface Props {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  /** `new-password` on sign-up and reset (password managers offer a new one), else `current-password`. */
  readonly autoComplete: "new-password" | "current-password";
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The plain-words rule (the 12-character minimum), linked through aria-describedby. */
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
}

/**
 * A password input with a show/hide toggle (igs-pharma#115). The toggle keeps one label and says
 * its state through `aria-pressed`, so a screen reader hears "Show password, toggle button, not
 * pressed". Hint and error are tied to the input by id; the error marks it invalid.
 */
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  value,
  onChange,
  hint,
  error,
  minLength,
  maxLength,
}: Props) {
  const t = useTranslations("account");
  const [visible, setVisible] = useState(false);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} required>
        {label}
      </Label>
      {hint ? (
        <p id={hintId} className="text-sm text-[var(--color-text-subtle)]">
          {hint}
        </p>
      ) : null}
      <div className="flex items-stretch gap-2">
        <Input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          minLength={minLength}
          maxLength={maxLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          className="flex-1"
        />
        <Button
          type="button"
          variant="secondary"
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((shown) => !shown)}
        >
          {t("showPassword")}
        </Button>
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}
