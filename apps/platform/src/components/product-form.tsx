"use client";

import type { BrandView, ContentLocale, ProductView } from "@igs/module-catalog";
import { Alert, Button, FieldError, Label, Select, Stack, TextField, Textarea, cn } from "@igs/ui";
import { type KeyboardEvent, useActionState, useEffect, useId, useRef, useState } from "react";

import { type ProductFormState, saveProduct } from "../app/products/actions";
import {
  LEGAL_STATUS_LABELS,
  LOCALE_LABELS,
  PRODUCT_TYPE_LABELS,
  VAT_CLASS_LABELS,
  catalogErrorMessage,
} from "./catalog-labels";

const LOCALES = Object.keys(LOCALE_LABELS) as ContentLocale[];
const REQUIRED: readonly ContentLocale[] = ["nl", "fr"];
const CONTENT_FIELDS = ["shortDescription", "description", "warnings"] as const;
const CONTENT_FIELD_LABELS: Record<(typeof CONTENT_FIELDS)[number], string> = {
  shortDescription: "Short description",
  description: "Description",
  warnings: "Warnings",
};

const FIELD_ERRORS: Record<string, string> = {
  "catalog.cnk_invalid": "Enter exactly 7 digits.",
  "catalog.cnk_taken": "Another product already has this CNK.",
  too_small: "Fill this in.",
  too_big: "This is too long.",
  invalid_value: "Pick one of the options.",
  invalid_type: "This value is not valid.",
};
const fieldError = (code: string | undefined) =>
  code ? (FIELD_ERRORS[code] ?? "This value is not valid.") : undefined;

interface Props {
  readonly product?: ProductView;
  readonly brands: readonly BrandView[];
  /** A pharmacist sets the regulated fields; for everyone else they are read-only. */
  readonly canRegulate?: boolean;
  /** The VAT class a non-pharmacist's new product gets (shown read-only). */
  readonly editorVatClass?: string;
}

/** The submitted value when a save was refused, else the product's own value. */
const valueFrom =
  (state: ProductFormState) =>
  (name: string, fallback: string | number | boolean | null | undefined) =>
    state.values ? (state.values[name] ?? "") : fallback == null ? "" : String(fallback);

/**
 * Create and edit form for one product (igs-pharma#50): core fields, then one tab per language.
 * Hidden tab panels stay in the form (`hidden`, not unmounted), so every language is submitted.
 * Dutch and French are needed before the product can be made active.
 */
export function ProductForm({
  product,
  brands,
  canRegulate = false,
  editorVatClass = "BE_21",
}: Props) {
  const [state, action, pending] = useActionState(saveProduct, {});
  const value = valueFrom(state);
  const checked = (name: string, fallback: boolean) =>
    state.values ? state.values[name] === "on" : fallback;
  // read-only for non-pharmacists: always the stored value (a disabled field posts nothing)
  const regulated = (
    name: string,
    stored: string | undefined,
    pharmacistDefault: string,
    editorDefault: string,
  ) => (canRegulate ? value(name, stored ?? pharmacistDefault) : (stored ?? editorDefault));
  const contentOf = (locale: ContentLocale) => product?.content.find((c) => c.locale === locale);
  const errors = state.fields ?? {};
  const id = useId();

  const [tab, setTab] = useState<ContentLocale>("nl");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onTabKey = (event: KeyboardEvent) => {
    const i = LOCALES.indexOf(tab);
    const next =
      event.key === "ArrowRight"
        ? LOCALES[(i + 1) % LOCALES.length]
        : event.key === "ArrowLeft"
          ? LOCALES[(i - 1 + LOCALES.length) % LOCALES.length]
          : event.key === "Home"
            ? LOCALES[0]
            : event.key === "End"
              ? LOCALES[LOCALES.length - 1]
              : undefined;
    if (!next) return;
    event.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  const tabHasError = (locale: ContentLocale) =>
    Object.keys(errors).some((key) => key.startsWith(`content.${locale}.`));
  // a refused save shows the first language with an error, so the message is not hidden
  useEffect(() => {
    const first = LOCALES.find((locale) =>
      Object.keys(state.fields ?? {}).some((key) => key.startsWith(`content.${locale}.`)),
    );
    if (first) setTab(first);
  }, [state]);

  const select = (
    name: string,
    label: string,
    options: Record<string, string>,
    current: string,
    extra?: { readonly empty?: string; readonly readOnly?: boolean },
  ) => {
    const fieldId = `${id}-${name}`;
    const error = fieldError(errors[name]);
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId} required={!extra?.empty}>
          {label}
        </Label>
        <Select
          id={fieldId}
          name={name}
          defaultValue={current}
          required={!extra?.empty}
          disabled={extra?.readOnly}
          invalid={Boolean(error)}
          aria-describedby={error ? `${fieldId}-error` : undefined}
        >
          {extra?.empty !== undefined ? <option value="">{extra.empty}</option> : null}
          {Object.entries(options).map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </Select>
        {error ? <FieldError id={`${fieldId}-error`}>{error}</FieldError> : null}
      </div>
    );
  };

  return (
    <form action={action} noValidate className="flex flex-col gap-8">
      {product ? <input type="hidden" name="productId" value={product.id} /> : null}
      {state.error ? (
        <Alert variant="error" title="The product was not saved">
          {catalogErrorMessage(state.error)}
        </Alert>
      ) : null}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-display text-xl font-semibold">Product</legend>
        <TextField
          label="CNK"
          name="cnk"
          inputMode="numeric"
          autoComplete="off"
          hint="7 digits"
          required
          maxLength={7}
          defaultValue={value("cnk", product?.cnk)}
          error={fieldError(errors["cnk"])}
        />
        {select(
          "brandId",
          "Brand",
          Object.fromEntries(brands.map((b) => [b.id, b.name])),
          value("brandId", product?.brandId),
          { empty: "No brand" },
        )}
        {select(
          "productType",
          "Product type",
          PRODUCT_TYPE_LABELS,
          regulated("productType", product?.productType, "otc_medicine", "general"),
          { readOnly: !canRegulate },
        )}
        {select(
          "legalStatus",
          "Legal status",
          LEGAL_STATUS_LABELS,
          regulated("legalStatus", product?.legalStatus, "otc", "general_sale"),
          { readOnly: !canRegulate },
        )}
        {select(
          "vatClass",
          "VAT",
          VAT_CLASS_LABELS,
          regulated("vatClass", product?.vatClass, "BE_6", editorVatClass),
          { readOnly: !canRegulate },
        )}
        {canRegulate ? null : (
          <p className="text-sm text-[var(--color-text-subtle)] sm:col-span-2">
            Product type, legal status and VAT class are set by a pharmacist.
          </p>
        )}
        <TextField
          label="Minimum age"
          name="ageMin"
          type="number"
          min={0}
          max={120}
          hint="Leave empty when there is none"
          defaultValue={canRegulate ? value("ageMin", product?.ageMin) : (product?.ageMin ?? "")}
          disabled={!canRegulate}
          error={fieldError(errors["ageMin"])}
        />
        <Stack gap={2} className="sm:col-span-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="requiresPharmacistReview"
              disabled={!canRegulate}
              defaultChecked={
                canRegulate
                  ? checked("requiresPharmacistReview", product?.requiresPharmacistReview ?? false)
                  : (product?.requiresPharmacistReview ?? false)
              }
              className="size-5 accent-[var(--color-primary)]"
            />
            Needs a pharmacist's review before it ships
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="coldChain"
              defaultChecked={checked("coldChain", product?.coldChain ?? false)}
              className="size-5 accent-[var(--color-primary)]"
            />
            Cold chain (keep refrigerated)
          </label>
        </Stack>
      </fieldset>

      <section aria-labelledby={`${id}-content`} className="flex flex-col gap-4">
        <h2 id={`${id}-content`} className="font-display text-xl font-semibold">
          Content
        </h2>
        <p className="text-sm text-[var(--color-text-subtle)]">
          Dutch and French are needed before the product can be made active.
        </p>
        <div
          role="tablist"
          aria-label="Content language"
          className="flex gap-1 border-b border-[var(--color-border-strong)]"
        >
          {LOCALES.map((locale) => (
            <button
              key={locale}
              ref={(el) => {
                tabRefs.current[locale] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${locale}`}
              aria-selected={tab === locale}
              aria-controls={`${id}-panel-${locale}`}
              tabIndex={tab === locale ? 0 : -1}
              onClick={() => setTab(locale)}
              onKeyDown={onTabKey}
              className={cn(
                "-mb-px min-h-[44px] rounded-t-[var(--radius-md)] border border-b-0 px-4 font-medium",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
                tab === locale
                  ? "border-[var(--color-border-strong)] bg-[var(--color-bg)] text-[var(--color-primary)]"
                  : "border-transparent text-[var(--color-text-subtle)] hover:text-[var(--color-text)]",
              )}
            >
              {LOCALE_LABELS[locale]}
              {REQUIRED.includes(locale) ? <span aria-hidden="true"> *</span> : null}
              {tabHasError(locale) ? <span className="sr-only"> (has errors)</span> : null}
            </button>
          ))}
        </div>
        {LOCALES.map((locale) => {
          const content = contentOf(locale);
          const prefix = `content.${locale}`;
          return (
            <div
              key={locale}
              role="tabpanel"
              id={`${id}-panel-${locale}`}
              aria-labelledby={`${id}-tab-${locale}`}
              hidden={tab !== locale}
              className="flex flex-col gap-4"
            >
              <TextField
                label={`Name (${LOCALE_LABELS[locale]})`}
                name={`${prefix}.name`}
                maxLength={200}
                defaultValue={value(`${prefix}.name`, content?.name)}
                error={fieldError(errors[`${prefix}.name`])}
              />
              {CONTENT_FIELDS.map((field) => {
                const fieldId = `${id}-${locale}-${field}`;
                const error = fieldError(errors[`${prefix}.${field}`]);
                return (
                  <div key={field} className="flex flex-col gap-1.5">
                    <Label htmlFor={fieldId}>
                      {CONTENT_FIELD_LABELS[field]} ({LOCALE_LABELS[locale]})
                    </Label>
                    <Textarea
                      id={fieldId}
                      name={`${prefix}.${field}`}
                      rows={field === "description" ? 6 : 3}
                      defaultValue={value(`${prefix}.${field}`, content?.[field])}
                      invalid={Boolean(error)}
                      aria-describedby={error ? `${fieldId}-error` : undefined}
                    />
                    {error ? <FieldError id={`${fieldId}-error`}>{error}</FieldError> : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </section>

      <div>
        <Button type="submit" loading={pending}>
          {product ? "Save changes" : "Create product"}
        </Button>
      </div>
    </form>
  );
}
