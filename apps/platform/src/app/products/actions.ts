"use server";

import { isDomainError } from "@igs/kernel";
import {
  CONTENT_LOCALES,
  createProduct,
  setProductCategories,
  setProductStatus,
  updateProduct,
} from "@igs/module-catalog";
import { parseEuros, setPrice } from "@igs/module-pricing";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { brusselsLocalToDate } from "../../components/price-labels";
import { requestOrigin, requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

/** What the product form shows after a refused save (codes only; the form maps them to text). */
export interface ProductFormState {
  readonly error?: string;
  /** Field name in the form (`cnk`, `content.fr.name`, …) → error code. */
  readonly fields?: Readonly<Record<string, string>>;
  /** The submitted values, so the form keeps what was typed. */
  readonly values?: Readonly<Record<string, string>>;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** The form's fields → the command input; a locale counts when any of its fields is filled in. */
function productInput(form: FormData) {
  const content = CONTENT_LOCALES.flatMap((locale) => {
    const item = {
      locale,
      name: text(form, `content.${locale}.name`),
      shortDescription: text(form, `content.${locale}.shortDescription`),
      description: text(form, `content.${locale}.description`),
      warnings: text(form, `content.${locale}.warnings`),
    };
    const filled = [item.name, item.shortDescription, item.description, item.warnings].some(
      (v) => v.trim() !== "",
    );
    return filled ? [item] : [];
  });
  const ageMin = text(form, "ageMin").trim();
  return {
    cnk: text(form, "cnk"),
    productType: text(form, "productType"),
    legalStatus: text(form, "legalStatus"),
    vatClass: text(form, "vatClass"),
    requiresPharmacistReview: form.get("requiresPharmacistReview") === "on",
    ageMin: ageMin === "" ? null : Number(ageMin),
    coldChain: form.get("coldChain") === "on",
    brandId: text(form, "brandId") || null,
    content,
  };
}

/** A refusal → form state: field paths of the command input mapped back to form field names. */
function refused(
  error: unknown,
  input: ReturnType<typeof productInput>,
  form: FormData,
): ProductFormState {
  if (!isDomainError(error)) throw error;
  const fields: Record<string, string> = {};
  for (const issue of error.fields ?? []) {
    const [head, index, field] = issue.path.split(".");
    if (head === "content" && index !== undefined && field) {
      const locale = input.content[Number(index)]?.locale;
      if (locale) fields[`content.${locale}.${field}`] = issue.code;
    } else if (head) {
      fields[head] = issue.code;
    }
  }
  if (error.code === "catalog.cnk_invalid" || error.code === "catalog.cnk_taken") {
    fields["cnk"] = error.code;
  }
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") values[key] = value;
  return { error: error.code, fields, values };
}

export async function saveProduct(
  _previous: ProductFormState,
  form: FormData,
): Promise<ProductFormState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const productId = text(form, "productId");
  const input = productInput(form);
  const options = { origin: await requestOrigin() };
  let savedId: string;
  try {
    const result = productId
      ? await updateProduct(
          { productId, expectedVersion: Number.parseInt(text(form, "version"), 10), ...input },
          actor,
          options,
        )
      : await createProduct(input, actor, options);
    savedId = result.productId;
  } catch (error) {
    return refused(error, input, form);
  }
  revalidatePath("/products");
  redirect(`/products/${savedId}?saved=1`);
}

/** The status buttons on the product page: a plain form, so it works without JavaScript too. */
export async function changeStatus(form: FormData): Promise<void> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const productId = text(form, "productId");
  const status = text(form, "status");
  let query: string;
  try {
    await setProductStatus({ productId, status }, actor, { origin: await requestOrigin() });
    query = `status=${encodeURIComponent(status)}`;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    query = `error=${encodeURIComponent(error.code)}`;
  }
  revalidatePath("/products");
  redirect(`/products/${encodeURIComponent(productId)}?${query}`);
}

/** The category checkboxes on the product page (igs-pharma#54): saves the ticked set. */
export async function saveProductCategories(form: FormData): Promise<void> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const productId = text(form, "productId");
  const categoryIds = form.getAll("categoryId").filter((v): v is string => typeof v === "string");
  let query: string;
  try {
    await setProductCategories({ productId, categoryIds }, actor, {
      origin: await requestOrigin(),
    });
    query = "categories=1";
  } catch (error) {
    if (!isDomainError(error)) throw error;
    query = `categoriesError=${encodeURIComponent(error.code)}`;
  }
  revalidatePath("/products");
  revalidatePath("/categories");
  redirect(`/products/${encodeURIComponent(productId)}?${query}#categories-heading`);
}

/** The Change price dialog on the product page (igs-pharma#59). */
export interface PriceFormState {
  readonly error?: string;
  readonly values?: Readonly<Record<string, string>>;
}

/**
 * Sets the product's web price: euros typed by staff (VAT included) → whole cents; "from now" or
 * from a date and time in Brussels.
 */
export async function changePrice(
  _previous: PriceFormState,
  form: FormData,
): Promise<PriceFormState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const productId = text(form, "productId");
  const values = {
    amount: text(form, "amount"),
    when: text(form, "when") === "later" ? "later" : "now",
    validFrom: text(form, "validFrom"),
    reason: text(form, "reason"),
  };
  const amountCents = parseEuros(values.amount);
  if (amountCents === null) return { error: "pricing.amount_invalid", values };
  let validFrom: string | undefined;
  if (values.when === "later") {
    const moment = brusselsLocalToDate(values.validFrom);
    if (!moment) return { error: "pricing.valid_from_invalid", values };
    validFrom = moment.toISOString();
  }
  let scheduled: boolean;
  try {
    ({ scheduled } = await setPrice(
      {
        productId,
        amountCents,
        ...(validFrom ? { validFrom } : {}),
        ...(values.reason.trim() ? { reason: values.reason } : {}),
      },
      actor,
      { origin: await requestOrigin() },
    ));
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code, values };
  }
  revalidatePath("/products");
  redirect(
    `/products/${encodeURIComponent(productId)}?price=${scheduled ? "scheduled" : "set"}#price`,
  );
}
