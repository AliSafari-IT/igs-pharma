"use client";

import { Alert, Button, FieldError, Label, Select, TextField } from "@igs/ui";
import { useActionState, useId } from "react";

import { type CategoryFormState, saveCategory } from "../app/categories/actions";
import { catalogErrorMessage } from "./catalog-labels";

const FIELD_ERRORS: Record<string, string> = {
  "catalog.category_slug_taken": "Another category already uses this web address.",
  invalid_format: "Use lowercase letters, digits and single dashes, like pain-and-fever.",
  too_small: "Fill this in.",
  too_big: "This is too long.",
};
const fieldError = (code: string | undefined) =>
  code ? (FIELD_ERRORS[code] ?? "This value is not valid.") : undefined;

export interface CategoryFormValues {
  readonly id: string;
  readonly slug: string;
  readonly nameNl: string;
  readonly nameFr: string;
  readonly nameDe: string | null;
  readonly nameEn: string | null;
  readonly version: number;
}

/** A parent the new category can go under, already indented for the select. */
export interface ParentOption {
  readonly id: string;
  readonly label: string;
}

interface Props {
  /** The category to edit; without it the form creates one. */
  readonly category?: CategoryFormValues;
  /** Create only: where the new category can go (it can be a root too). */
  readonly parents?: readonly ParentOption[];
  readonly defaultParentId?: string;
}

const NAMES = [
  { name: "nameNl", label: "Name (Dutch)", required: true },
  { name: "nameFr", label: "Name (French)", required: true },
  { name: "nameDe", label: "Name (German)", required: false },
  { name: "nameEn", label: "Name (English)", required: false },
] as const;

/** Create and rename form for a category (igs-pharma#54). Dutch and French names are required. */
export function CategoryForm({ category, parents, defaultParentId }: Props) {
  const [state, action, pending] = useActionState<CategoryFormState, FormData>(saveCategory, {});
  const errors = state.fields ?? {};
  const value = (name: string, fallback: string | null | undefined) =>
    state.values ? (state.values[name] ?? "") : (fallback ?? "");
  const id = useId();
  const parentError = fieldError(errors["parentId"]);

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      {category ? <input type="hidden" name="categoryId" value={category.id} /> : null}
      {category ? <input type="hidden" name="version" value={String(category.version)} /> : null}
      {state.error ? (
        <Alert variant="error" title="The category was not saved">
          {catalogErrorMessage(state.error)}
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {NAMES.map((field) => (
          <TextField
            key={field.name}
            label={field.label}
            name={field.name}
            required={field.required}
            maxLength={100}
            defaultValue={value(field.name, category?.[field.name])}
            error={fieldError(errors[field.name])}
          />
        ))}
        <TextField
          label="Web address"
          name="slug"
          required
          maxLength={100}
          autoComplete="off"
          hint="Lowercase letters, digits and dashes, like pain-and-fever"
          defaultValue={value("slug", category?.slug)}
          error={fieldError(errors["slug"])}
        />
        {parents ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-parent`}>Put it under</Label>
            <Select
              id={`${id}-parent`}
              name="parentId"
              defaultValue={value("parentId", defaultParentId)}
              invalid={Boolean(parentError)}
              aria-describedby={parentError ? `${id}-parent-error` : undefined}
            >
              <option value="">Nothing (a main category)</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
            {parentError ? <FieldError id={`${id}-parent-error`}>{parentError}</FieldError> : null}
          </div>
        ) : null}
      </div>
      <div>
        <Button type="submit" loading={pending}>
          {category ? "Save changes" : "Add category"}
        </Button>
      </div>
    </form>
  );
}
