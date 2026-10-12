import { isDomainError } from "@igs/kernel";
import { type CategoryNode, MAX_CATEGORY_DEPTH, listCategories } from "@igs/module-catalog";
import { Alert, Button, Container, Label, Link, Select, Stack } from "@igs/ui";
import { notFound } from "next/navigation";

import { catalogErrorMessage } from "../../../components/catalog-labels";
import { CategoryForm } from "../../../components/category-form";
import { heightOf, parentOptions, subtreeOf } from "../../../components/category-options";
import { requireStaffActor } from "../../../server/actor";
import { ensureKernelConfigured } from "../../../server/kernel";
import { deleteCategoryAction, moveCategoryAction } from "../actions";

export const metadata = { title: "Category · IGS-Pharma Platform" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<{ saved?: string; moved?: string; error?: string }>;
}

/** Rename a category, move it under another one, or delete it (igs-pharma#54). */
export default async function CategoryPage({ params, searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const { id } = await params;
  const flash = await searchParams;
  if (!UUID.test(id)) notFound();

  let nodes: readonly CategoryNode[] | null = null;
  let error: string | null = null;
  try {
    nodes = await listCategories({}, actor);
  } catch (e) {
    if (!isDomainError(e)) throw e;
    error = e.code;
  }
  if (!nodes) {
    return (
      <Container asChild size="md">
        <main className="py-10">
          <Alert variant="error" title="You can't see the catalogue">
            {catalogErrorMessage(error ?? undefined)}
          </Alert>
        </main>
      </Container>
    );
  }
  const node = nodes.find((n) => n.id === id);
  if (!node) notFound();

  const parents = parentOptions(
    nodes,
    MAX_CATEGORY_DEPTH,
    heightOf(nodes, id),
    subtreeOf(nodes, id),
  );
  const parent = nodes.find((n) => n.id === node.parentId);
  const canDelete = node.childCount === 0 && node.productCount === 0;

  return (
    <Container asChild size="md">
      <main className="py-10">
        <Stack gap={8}>
          <Link href="/categories">Back to categories</Link>
          <h1 className="font-display text-4xl font-medium text-[var(--color-primary)]">
            {node.nameNl}
          </h1>

          {flash.saved ? <Alert variant="success" title="Category saved" /> : null}
          {flash.moved ? <Alert variant="success" title="Category moved" /> : null}
          {flash.error ? (
            <Alert variant="error" title="That didn't work">
              {catalogErrorMessage(flash.error)}
            </Alert>
          ) : null}

          <section aria-labelledby="names-heading" className="flex flex-col gap-3">
            <h2 id="names-heading" className="font-display text-xl font-semibold">
              Names
            </h2>
            <CategoryForm key={`${node.slug}-${node.nameNl}-${node.nameFr}`} category={node} />
          </section>

          <section aria-labelledby="place-heading" className="flex flex-col gap-3">
            <h2 id="place-heading" className="font-display text-xl font-semibold">
              Place in the tree
            </h2>
            <p className="text-sm text-[var(--color-text-subtle)]">
              Now {parent ? `under ${parent.nameNl}` : "a main category"}. Moving it takes its
              sub-categories along, and puts it last among its new neighbours.
            </p>
            <form action={moveCategoryAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="categoryId" value={node.id} />
              <input type="hidden" name="position" value="10000" />
              <input type="hidden" name="from" value="edit" />
              <div className="flex min-w-64 flex-1 flex-col gap-1.5">
                <Label htmlFor="move-parent">Move it under</Label>
                <Select id="move-parent" name="parentId" defaultValue={node.parentId ?? ""}>
                  <option value="">Nothing (a main category)</option>
                  {parents.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" variant="secondary">
                Move
              </Button>
            </form>
            {node.depth < MAX_CATEGORY_DEPTH ? (
              <Link href={`/categories?parent=${node.id}#add-heading`}>Add a sub-category</Link>
            ) : null}
          </section>

          <section aria-labelledby="delete-heading" className="flex flex-col gap-3">
            <h2 id="delete-heading" className="font-display text-xl font-semibold">
              Delete
            </h2>
            {canDelete ? (
              <form action={deleteCategoryAction}>
                <input type="hidden" name="categoryId" value={node.id} />
                <input type="hidden" name="from" value="edit" />
                <Button type="submit" variant="danger">
                  Delete this category
                </Button>
              </form>
            ) : (
              <p className="text-sm text-[var(--color-text-subtle)]">
                Only an empty category can be deleted. This one has {node.childCount} sub-categor
                {node.childCount === 1 ? "y" : "ies"} and {node.productCount} product
                {node.productCount === 1 ? "" : "s"}.
              </p>
            )}
          </section>
        </Stack>
      </main>
    </Container>
  );
}
