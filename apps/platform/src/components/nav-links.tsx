"use client";

import { Link } from "@igs/ui";
import { usePathname } from "next/navigation";

import { type NavGroup, isActive } from "../lib/nav";

/**
 * The sidebar's groups and links. A client component only to know the current path, so the page the
 * member is on carries `aria-current="page"` (and a heavier look: the mark is never colour alone).
 */
export function NavLinks({
  groups,
  label,
}: { readonly groups: readonly NavGroup[]; readonly label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex flex-col gap-4 py-3">
      {groups.map((group) => (
        <div key={group.label}>
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
            {group.label}
          </h2>
          <ul className="mt-1 flex flex-col">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-[44px] items-center rounded-[var(--radius-md)] px-3 no-underline ${
                      active
                        ? "bg-[var(--color-primary-muted)] font-semibold text-[var(--color-primary-active)]"
                        : "hover:bg-[var(--color-surface-2)]"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
