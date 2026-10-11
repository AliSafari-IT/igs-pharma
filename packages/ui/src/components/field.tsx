import type React from "react";
import { useId } from "react";

import { type ContrastPair, FOCUS_RING, onSurfaces } from "../contrast";
import { cn } from "../utils";

export const inputClasses = {
  base: [
    "block w-full min-h-[44px] rounded-[var(--radius-md)] px-3 py-2",
    "bg-[var(--color-bg)] text-[var(--color-text)] font-sans text-base",
    "border border-[var(--color-border-strong)] placeholder:text-[var(--color-text-muted)]",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
    "disabled:cursor-not-allowed disabled:bg-[var(--color-surface-2)] disabled:opacity-70",
  ].join(" "),
  invalid: "border-2 border-[var(--color-error-text)]",
} as const;

/** The input sits on the page or a card; its own fill is always --color-bg. */
export const inputContrast: Record<"default" | "invalid", ContrastPair[]> = {
  default: [
    { fg: "text", bg: "bg", use: "text" },
    { fg: "text-muted", bg: "bg", use: "text" },
    ...onSurfaces("border-strong", "ui"),
    ...FOCUS_RING,
  ],
  invalid: [{ fg: "text", bg: "bg", use: "text" }, ...onSurfaces("error-text", "ui")],
};

export const labelClasses = "block text-sm font-medium text-[var(--color-text)]";
export const fieldErrorClasses = "flex items-start gap-1.5 text-sm text-[var(--color-error-text)]";
export const hintClasses = "text-sm text-[var(--color-text-subtle)]";

export const fieldTextContrast: Record<"label" | "error" | "hint", ContrastPair[]> = {
  label: onSurfaces("text", "text"),
  error: onSurfaces("error-text", "text"),
  hint: onSurfaces("text-subtle", "text"),
};

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Sets aria-invalid and the error border. Point aria-describedby at the FieldError. */
  invalid?: boolean;
}

export function Input({ className, invalid = false, ...props }: InputProps) {
  return (
    <input
      className={cn(inputClasses.base, invalid && inputClasses.invalid, className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** As on `Input`. */
  invalid?: boolean;
}

/** A native `<select>` drawn like `Input` (same tokens, so `inputContrast` covers it). */
export function Select({ className, invalid = false, ...props }: SelectProps) {
  return (
    <select
      className={cn(inputClasses.base, invalid && inputClasses.invalid, className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** As on `Input`. */
  invalid?: boolean;
}

/** A `<textarea>` drawn like `Input` (same tokens, so `inputContrast` covers it). */
export function Textarea({ className, invalid = false, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(inputClasses.base, invalid && inputClasses.invalid, className)}
      aria-invalid={invalid || undefined}
      rows={rows}
      {...props}
    />
  );
}

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Shows a visual "*"; the input's own `required` is what assistive technology announces. */
  required?: boolean;
}

export function Label({ className, required = false, children, ...props }: LabelProps) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: callers pass htmlFor (TextField always does)
    <label className={cn(labelClasses, className)} {...props}>
      {children}
      {required ? (
        <span aria-hidden="true" className="ml-0.5 text-[var(--color-error-text)]">
          *
        </span>
      ) : null}
    </label>
  );
}

function ErrorIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="mt-0.5 size-4 shrink-0"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm-.75-11.25a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4ZM10 14.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
      />
    </svg>
  );
}

/** An error message for one field: icon plus text, never colour alone. Give it an `id`. */
export function FieldError({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn(fieldErrorClasses, className)} {...props}>
      <ErrorIcon />
      <span>{children}</span>
    </p>
  );
}

export interface TextFieldProps extends Omit<InputProps, "id" | "invalid"> {
  label: React.ReactNode;
  hint?: React.ReactNode;
  /** When set, the field is invalid and this message is linked through aria-describedby. */
  error?: React.ReactNode;
  id?: string;
}

/** Label + Input + hint + FieldError with the ids and ARIA attributes wired up. */
export function TextField({
  label,
  hint,
  error,
  id,
  required,
  className,
  ...props
}: TextFieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={inputId} required={required ?? false}>
        {label}
      </Label>
      {hint ? (
        <p id={hintId} className={hintClasses}>
          {hint}
        </p>
      ) : null}
      <Input
        id={inputId}
        required={required}
        invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
        {...props}
      />
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}
