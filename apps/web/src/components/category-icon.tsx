import type { ReactNode } from "react";

import { type CategoryIconName, categoryIconFor } from "../lib/category-icon";

// One set (design system §10.4): line art in Deep Teal, Fresh Teal-ish fills, Amber details.
// Colours come from tokens through classes only; amber is never a text colour here.
const LINE = "stroke-[var(--color-primary)]";
const FILL = "fill-[var(--color-primary-muted)] stroke-[var(--color-primary)]";
const ACCENT = "fill-[var(--color-accent)] stroke-none";
const ACCENT_LINE = "stroke-[var(--color-accent)]";

const ICONS: Readonly<Record<CategoryIconName, ReactNode>> = {
  // a thermometer
  "pain-fever": (
    <>
      <rect className={FILL} x="16.5" y="4" width="7" height="22" rx="3.5" />
      <circle className={FILL} cx="20" cy="30" r="6" />
      <path className={ACCENT_LINE} d="M20 14v14" />
      <circle className={ACCENT} cx="20" cy="30" r="3" />
      <path className={LINE} d="M26.5 9h3M26.5 14h3M26.5 19h3" />
    </>
  ),
  // a tissue box
  "cold-flu": (
    <>
      <rect className={FILL} x="6" y="18" width="28" height="15" rx="2" />
      <path className={LINE} d="M14 18c0-5 4-6 6-11c2 5 6 6 6 11" />
      <path className={ACCENT_LINE} d="M14 23h12" />
    </>
  ),
  // a flower
  allergy: (
    <>
      <path className={LINE} d="M20 24v12M20 31c-4 0-6-2-7-5" />
      <circle className={FILL} cx="20" cy="9.5" r="4.5" />
      <circle className={FILL} cx="27" cy="14.5" r="4.5" />
      <circle className={FILL} cx="24.5" cy="22" r="4.5" />
      <circle className={FILL} cx="15.5" cy="22" r="4.5" />
      <circle className={FILL} cx="13" cy="14.5" r="4.5" />
      <circle className={ACCENT} cx="20" cy="16.5" r="3.5" />
    </>
  ),
  // a citrus slice (no pills or capsules, §1)
  vitamins: (
    <>
      <circle className={FILL} cx="20" cy="20" r="14" />
      <circle className={LINE} cx="20" cy="20" r="10.5" />
      <path className={LINE} d="M20 9.5v21M10.9 14.75l18.2 10.5M10.9 25.25l18.2-10.5" />
      <circle className={ACCENT} cx="20" cy="20" r="2" />
    </>
  ),
  // a drop
  "skin-care": (
    <>
      <path className={FILL} d="M20 5c5 7 10 12 10 19a10 10 0 0 1-20 0c0-7 5-12 10-19z" />
      <path className={ACCENT_LINE} d="M15 25a5 5 0 0 0 4 5" />
    </>
  ),
  // a plaster
  "first-aid": (
    <g transform="rotate(-35 20 20)">
      <rect className={FILL} x="4" y="13" width="32" height="14" rx="7" />
      <rect className={ACCENT} x="14.5" y="15" width="11" height="10" rx="1.5" />
      <path className={LINE} d="M9 20h1M30 20h1" />
    </g>
  ),
  // a bar of soap with bubbles
  hygiene: (
    <>
      <rect className={FILL} x="5" y="21" width="23" height="13" rx="4" />
      <circle className={LINE} cx="27" cy="12" r="4.5" />
      <circle className={LINE} cx="34" cy="20" r="2.5" />
      <circle className={ACCENT} cx="19" cy="10" r="2.5" />
    </>
  ),
  // a feeding bottle
  baby: (
    <>
      <path className={LINE} d="M17 10c0-4 6-4 6 0" />
      <rect className={ACCENT} x="15" y="10" width="10" height="4" rx="1" />
      <rect className={FILL} x="14" y="14" width="12" height="21" rx="4" />
      <path className={LINE} d="M18 21h4M18 26h4" />
    </>
  ),
  // a box, for any category without its own icon
  generic: (
    <>
      <path className={LINE} d="M7 15l4-7h18l4 7" />
      <rect className={FILL} x="7" y="15" width="26" height="18" rx="3" />
      <path className={ACCENT_LINE} d="M16 22h8" />
    </>
  ),
};

/**
 * A category's icon on its tile: a fixed 40 px box (no layout shift), decorative only. It is hidden
 * from assistive technology because the category name next to it already says what it shows.
 */
export function CategoryIcon({ slug }: { readonly slug: string }) {
  const name = categoryIconFor(slug);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-testid="category-icon"
      data-icon={name}
      viewBox="0 0 40 40"
      width="40"
      height="40"
      className="h-10 w-10 shrink-0"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name]}
    </svg>
  );
}
