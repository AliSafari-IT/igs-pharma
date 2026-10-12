import type { CategoryNode } from "@igs/module-catalog";

import type { ParentOption } from "./category-form";

/** The Dutch name, indented by depth, for a `<select>` (options can't hold markup). */
export const indented = (node: CategoryNode) => `${"— ".repeat(node.depth - 1)}${node.nameNl}`;

/** The ids of `id` and everything under it. */
export function subtreeOf(nodes: readonly CategoryNode[], id: string): Set<string> {
  const ids = new Set([id]);
  // `nodes` is in reading order: a child always comes after its parent
  for (const node of nodes) if (node.parentId !== null && ids.has(node.parentId)) ids.add(node.id);
  return ids;
}

/**
 * Where a category spanning `height` levels can go: not under itself or its own sub-categories
 * (`exclude`), and not so deep that the tree passes `maxDepth`.
 */
export function parentOptions(
  nodes: readonly CategoryNode[],
  maxDepth: number,
  height = 1,
  exclude: ReadonlySet<string> = new Set(),
): ParentOption[] {
  return nodes
    .filter((n) => !exclude.has(n.id) && n.depth + height <= maxDepth)
    .map((n) => ({ id: n.id, label: indented(n) }));
}

/** How many levels the subtree under `id` spans, `id` itself included. */
export function heightOf(nodes: readonly CategoryNode[], id: string): number {
  const subtree = subtreeOf(nodes, id);
  const top = nodes.find((n) => n.id === id)?.depth ?? 1;
  return nodes.reduce((max, n) => (subtree.has(n.id) ? Math.max(max, n.depth - top + 1) : max), 1);
}
