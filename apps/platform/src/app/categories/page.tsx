import { isDomainError } from "@igs/kernel";
import { type CategoryNode, MAX_CATEGORY_DEPTH, listCategories } from "@igs/module-catalog";
import { Alert, Button, Container, EmptyState, Link, Stack } from "@igs/ui";

import { catalogErrorMessage } from "../../components/catalog-labels";
import { CategoryForm } from "../../components/category-form";
import { parentOptions } from "../../components/category-options";
import { PageHeader } from "../../components/page-header";
import { requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";
import { moveCategoryAction } from "./actions";

export const metadata = { title: "Categories · IGS-Pharma Platform" };

interface Props {
  readonly searchParams: Promise<{
    created?: string;
    moved?: string;
    deleted?: string;
    error?: string;
    parent?: string;
  }>;
}

/** One "Move up" / "Move down" button: a plain form posting the direction and the loaded version. */
function MoveButton({ node, by, label }: { node: CategoryNode; by: -1 | 1; label: string }) {
  const position = node.index + by;
  const disabled = position < 0 || position >= node.siblingCount;
  return (
    <form action={moveCategoryAction}>
      <input type="hidden" name="categoryId" value={node.id} />
      <input type="hidden" name="version" value={String(node.version)} />
      <input type="hidden" name="direction" value={by < 0 ? "up" : "down"} />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        disabled={disabled}
        aria-label={`${label}: ${node.nameNl}`}
      >
        {label}
      </Button>
    </form>
  );
}

function Branch({
  nodes,
  parentId,
  focus,
}: {
  nodes: readonly CategoryNode[];
  parentId: string | null;
  focus: string | undefined;
}) {
  const children = nodes.filter((n) => n.parentId === parentId);
  if (children.length === 0) return null;
  return (
    <ul className={parentId ? "ml-6 border-l border-[var(--color-border)] pl-4" : undefined}>
      {children.map((node) => (
        <li key={node.id} className="py-1">
          <div
            className={
              node.id === focus
                ? "flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] px-2 py-1"
                : "flex flex-wrap items-center gap-3 px-2 py-1"
            }
          >
            <Link href={`/categories/${node.id}`}>{node.nameNl}</Link>
            <span className="text-sm text-[var(--color-text-subtle)]">
              {node.nameFr} · <code>{node.slug}</code> · {node.productCount} product
              {node.productCount === 1 ? "" : "s"}
            </span>
            <span className="ml-auto flex gap-1">
              <MoveButton node={node} by={-1} label="Move up" />
              <MoveButton node={node} by={1} label="Move down" />
            </span>
          </div>
          <Branch nodes={nodes} parentId={node.id} focus={focus} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The category tree (igs-pharma#54): add, open to rename or move, and reorder siblings with the
 * Move up / Move down buttons (keyboard-friendly; there is no drag and drop).
 */
export default async function CategoriesPage({ searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const flash = await searchParams;

  let nodes: readonly CategoryNode[] | null = null;
  let error: string | null = null;
  try {
    nodes = await listCategories({}, actor);
  } catch (e) {
    if (!isDomainError(e)) throw e;
    error = e.code;
  }

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader
            title="Categories"
            description="How products are grouped in the storefront."
            back={{ href: "/", label: "Back to the dashboard" }}
          />

          {error ? (
            <Alert variant="error" title="You can't see the catalogue">
              {catalogErrorMessage(error)}
            </Alert>
          ) : null}
          {flash.created ? <Alert variant="success" title="Category added" /> : null}
          {flash.deleted ? <Alert variant="success" title="Category deleted" /> : null}
          {flash.error ? (
            <Alert variant="error" title="That didn't work">
              {catalogErrorMessage(flash.error)}
            </Alert>
          ) : null}

          {nodes ? (
            <>
              <section aria-labelledby="tree-heading" className="flex flex-col gap-3">
                <h2 id="tree-heading" className="font-display text-xl font-semibold">
                  All categories
                </h2>
                {nodes.length === 0 ? (
                  <EmptyState title="No categories yet" data-testid="categories-empty" />
                ) : (
                  <Branch nodes={nodes} parentId={null} focus={flash.created ?? flash.moved} />
                )}
              </section>

              <section aria-labelledby="add-heading" className="flex flex-col gap-3">
                <h2 id="add-heading" className="font-display text-xl font-semibold">
                  Add a category
                </h2>
                {/* a new key per added category: the form starts empty again */}
                <CategoryForm
                  key={flash.created ?? "new"}
                  parents={parentOptions(nodes, MAX_CATEGORY_DEPTH)}
                  {...(flash.parent ? { defaultParentId: flash.parent } : {})}
                />
              </section>
            </>
          ) : null}
        </Stack>
      </main>
    </Container>
  );
}
