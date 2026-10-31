import type { StorefrontCategoryNode } from "@igs/module-storefront";

/**
 * The categories from the top of the tree down to `slug` (the last one is `slug` itself), for the
 * breadcrumbs. Empty when the slug is not in the tree. Stops on a broken tree (a cycle) instead of
 * looping.
 */
export function categoryPath(
  tree: readonly StorefrontCategoryNode[],
  slug: string,
): StorefrontCategoryNode[] {
  const byId = new Map(tree.map((category) => [category.id, category]));
  const start = tree.find((category) => category.slug === slug);
  if (!start) return [];
  const path: StorefrontCategoryNode[] = [];
  const seen = new Set<string>();
  for (let node: StorefrontCategoryNode | undefined = start; node; ) {
    if (seen.has(node.id)) break;
    seen.add(node.id);
    path.unshift(node);
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return path;
}

/** The categories at the top of the tree, in the tree's order. */
export const topLevel = (tree: readonly StorefrontCategoryNode[]): StorefrontCategoryNode[] =>
  tree.filter((category) => category.parentId === null);

/**
 * What the category bar shows (igs-pharma#193): the top-level categories, which of them holds
 * `activeSlug`, and that branch's sub-categories (every level under it, in the tree's order) so a
 * shopper inside a branch can go deeper. No branch: no sub-categories.
 */
export function categoryBar(
  tree: readonly StorefrontCategoryNode[],
  activeSlug: string | undefined,
): {
  readonly top: readonly StorefrontCategoryNode[];
  readonly activeTopId: string | null;
  readonly branch: readonly StorefrontCategoryNode[];
} {
  const top = topLevel(tree);
  const path = activeSlug ? categoryPath(tree, activeSlug) : [];
  const root = path[0];
  if (!root) return { top, activeTopId: null, branch: [] };
  const under = new Set([root.id]);
  const branch: StorefrontCategoryNode[] = [];
  // the tree comes depth first: a node's parent is always met before it
  for (const category of tree) {
    if (category.parentId && under.has(category.parentId)) {
      under.add(category.id);
      branch.push(category);
    }
  }
  return { top, activeTopId: root.id, branch };
}
