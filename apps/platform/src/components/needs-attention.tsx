import { Link } from "@igs/ui";

import type { Attention } from "../lib/dashboard";

/**
 * The dashboard's "Needs attention" panel (igs-pharma#112 V1 item 1): the few things worth acting
 * on, each a link to the page where it is dealt with. Read-only; the numbers come from the tiles.
 */
export function NeedsAttention({ attention }: { readonly attention: Attention }) {
  const { items, incomplete } = attention;
  return (
    <section
      aria-labelledby="attention-title"
      data-testid="needs-attention"
      className="mt-6 flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4"
    >
      <h2 id="attention-title" className="font-display text-lg font-semibold">
        Needs attention
      </h2>
      {items.length === 0 ? (
        <p data-testid="needs-attention-empty" className="text-[var(--color-text-subtle)]">
          {incomplete
            ? "Nothing else needs attention in the numbers that loaded."
            : "Nothing needs attention right now."}
        </p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li key={item.id} data-testid={`attention-${item.id}`}>
              <Link href={item.href} className="inline-flex min-h-[44px] items-center">
                {item.text}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {incomplete && items.length > 0 ? (
        <p className="text-sm text-[var(--color-text-subtle)]">
          Some numbers could not be loaded, so this list may be incomplete.
        </p>
      ) : null}
    </section>
  );
}
