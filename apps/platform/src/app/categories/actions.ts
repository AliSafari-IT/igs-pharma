"use server";

import { isDomainError } from "@igs/kernel";
import { createCategory, deleteCategory, moveCategory, updateCategory } from "@igs/module-catalog";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requestOrigin, requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

/** What the category form shows after a refused save (codes only; the form maps them to text). */
export interface CategoryFormState {
  readonly error?: string;
  /** Field name → error code. */
  readonly fields?: Readonly<Record<string, string>>;
  /** The submitted values, so the form keeps what was typed. */
  readonly values?: Readonly<Record<string, string>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** The version the page loaded (a hidden field); 0 when missing, which the command refuses. */
const versionOf = (form: FormData) => Number.parseInt(text(form, "version"), 10) || 0;

const fieldsOf = (form: FormData) => ({
  slug: text(form, "slug"),
  nameNl: text(form, "nameNl"),
  nameFr: text(form, "nameFr"),
  nameDe: text(form, "nameDe"),
  nameEn: text(form, "nameEn"),
});

function refused(error: unknown, form: FormData): CategoryFormState {
  if (!isDomainError(error)) throw error;
  const fields: Record<string, string> = {};
  for (const issue of error.fields ?? []) {
    const [head] = issue.path.split(".");
    if (head) fields[head] = issue.code;
  }
  if (error.code === "catalog.category_slug_taken") fields["slug"] = error.code;
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") values[key] = value;
  return { error: error.code, fields, values };
}

/** Creates a category or saves its names (the form sends `categoryId` when editing). */
export async function saveCategory(
  _previous: CategoryFormState,
  form: FormData,
): Promise<CategoryFormState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const categoryId = text(form, "categoryId");
  const parentId = text(form, "parentId");
  const options = { origin: await requestOrigin() };
  let savedId: string;
  try {
    const result = categoryId
      ? await updateCategory(
          { categoryId, expectedVersion: versionOf(form), ...fieldsOf(form) },
          actor,
          options,
        )
      : await createCategory({ parentId: parentId || null, ...fieldsOf(form) }, actor, options);
    savedId = result.categoryId;
  } catch (error) {
    return refused(error, form);
  }
  revalidatePath("/categories");
  redirect(categoryId ? `/categories/${savedId}?saved=1` : `/categories?created=${savedId}`);
}

/** Where a move or delete form goes back to: the tree, or the category's own page. */
const back = (form: FormData, categoryId: string) =>
  text(form, "from") === "edit" && UUID.test(categoryId)
    ? `/categories/${categoryId}`
    : "/categories";

/**
 * Moves a category: up or down among its siblings (the tree's buttons), or under another parent
 * (the edit page). A plain form, so it works without JavaScript.
 */
export async function moveCategoryAction(form: FormData): Promise<void> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const categoryId = text(form, "categoryId");
  const direction = text(form, "direction");
  const parentId = text(form, "parentId");
  const position = Number.parseInt(text(form, "position"), 10);
  const expectedVersion = versionOf(form);
  let query: string;
  try {
    await moveCategory(
      direction === "up" || direction === "down"
        ? // one place among the siblings as they are NOW, not a position computed when the page rendered
          { categoryId, expectedVersion, direction }
        : {
            categoryId,
            expectedVersion,
            parentId: parentId || null,
            position: Number.isNaN(position) ? 10_000 : position,
          },
      actor,
      { origin: await requestOrigin() },
    );
    query = `moved=${encodeURIComponent(categoryId)}`;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    query = `error=${encodeURIComponent(error.code)}`;
  }
  revalidatePath("/categories");
  redirect(`${back(form, categoryId)}?${query}`);
}

/** Deletes an empty category; a refusal goes back to the page it came from. */
export async function deleteCategoryAction(form: FormData): Promise<void> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const categoryId = text(form, "categoryId");
  try {
    await deleteCategory({ categoryId }, actor, { origin: await requestOrigin() });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    redirect(`${back(form, categoryId)}?error=${encodeURIComponent(error.code)}`);
  }
  revalidatePath("/categories");
  redirect("/categories?deleted=1");
}
