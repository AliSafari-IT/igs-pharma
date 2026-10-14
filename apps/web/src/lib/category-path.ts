import type { StorefrontCategory } from "@igs/module-catalog";

/**
 * The categories from the top of the tree down to `slug` (the last one is `slug` itself), for the
 * breadcrumbs. Empty when the slug is not in the tree. Stops on a broken tree (a cycle) instead of
 * looping.
 */
export function categoryPath(
  tree: readonly StorefrontCategory[],
  slug: string,
): StorefrontCategory[] {
  const byId = new Map(tree.map((category) => [category.id, category]));
  const start = tree.find((category) => category.slug === slug);
  if (!start) return [];
  const path: StorefrontCategory[] = [];
  const seen = new Set<string>();
  for (let node: StorefrontCategory | undefined = start; node; ) {
    if (seen.has(node.id)) break;
    seen.add(node.id);
    path.unshift(node);
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return path;
}

/** The categories at the top of the tree, in the tree's order. */
export const topLevel = (tree: readonly StorefrontCategory[]): StorefrontCategory[] =>
  tree.filter((category) => category.parentId === null);
