/**
 * Typed contrast manifest (T-017). Every variant declares the token pairs it puts on screen; the
 * contrast test (contrast.test.ts) computes their WCAG ratio from `styles/tokens.css`, the single
 * source of the colour values, and checks that each variant's classes really use those tokens.
 */

/** Every `--color-*` token in tokens.css. A test keeps this list equal to the file. */
export const COLOR_TOKENS = [
  "page",
  "primary",
  "primary-hover",
  "primary-active",
  "primary-subtle",
  "primary-muted",
  "on-primary",
  "secondary",
  "accent",
  "accent-subtle",
  "accent-strong",
  "bg",
  "surface",
  "surface-2",
  "border",
  "border-strong",
  "text",
  "text-muted",
  "text-subtle",
  "focus",
  "success",
  "success-text",
  "success-subtle",
  "error",
  "error-text",
  "error-subtle",
  "on-error",
  "warning",
  "warning-text",
  "info",
  "topbar",
  "topbar-raised",
  "on-topbar",
  "on-topbar-muted",
  "topbar-accent",
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

/**
 * Tokens that must never colour text (design system §2.2): Fresh Teal (`secondary`), Amber
 * (`accent`, `warning`), the bright success green and the decorative border. A manifest entry
 * with one of these as text cannot be written.
 */
export const NEVER_TEXT = ["secondary", "accent", "warning", "success", "border"] as const;

/**
 * `white` is Tailwind's `text-white`. Filled backgrounds use `on-primary` / `on-error` instead
 * (igs-pharma#191): white on the light-blue dark-theme primary would fail.
 */
export type TextFg = Exclude<ColorToken, (typeof NEVER_TEXT)[number]> | "white";

/** Borders, focus rings and other UI parts that must reach 3:1 (the decorative border never does). */
export type UiFg = Exclude<ColorToken, "border" | "secondary">;

export type ContrastPair =
  | { fg: TextFg; bg: ColorToken; use: "text" | "large-text" }
  | { fg: UiFg; bg: ColorToken; use: "ui" };

/** WCAG 2.2 AA minimum per use. */
export const MIN_RATIO: Record<ContrastPair["use"], number> = {
  text: 4.5,
  "large-text": 3,
  ui: 3,
};

/** The surfaces a transparent component may sit on: the page, and the card backgrounds. */
export const SURFACES = ["page", "bg", "surface"] as const satisfies readonly ColorToken[];

/** The same foreground on every surface in `SURFACES`. */
export function onSurfaces(fg: TextFg, use: "text" | "large-text"): ContrastPair[];
export function onSurfaces(fg: UiFg, use: "ui"): ContrastPair[];
export function onSurfaces(fg: TextFg | UiFg, use: ContrastPair["use"]): ContrastPair[] {
  return SURFACES.map((bg) => ({ fg, bg, use }) as ContrastPair);
}

/** The keyboard focus ring every interactive primitive draws (`focus-visible:outline-…`). */
export const FOCUS_RING = onSurfaces("focus", "ui");

/**
 * The storefront's charcoal top bar (igs-pharma#193): what it puts on screen. Its links and text are
 * `on-topbar`, the cart count and the focus ring `topbar-accent` (the global navy focus ring would
 * vanish on charcoal), the hover `topbar-raised`.
 */
export const topBarContrast: ContrastPair[] = [
  { fg: "on-topbar", bg: "topbar", use: "text" },
  { fg: "on-topbar", bg: "topbar-raised", use: "text" },
  { fg: "on-topbar-muted", bg: "topbar", use: "text" },
  { fg: "topbar-accent", bg: "topbar", use: "text" },
  { fg: "topbar-accent", bg: "topbar-raised", use: "ui" },
  { fg: "topbar", bg: "topbar-accent", use: "text" },
];
