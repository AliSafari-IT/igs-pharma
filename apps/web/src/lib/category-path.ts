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
