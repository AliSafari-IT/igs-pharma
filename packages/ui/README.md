# @igs/ui

Design tokens, base styles and shared components (shadcn/ui-style) for both Next.js apps.

## Styles (Tailwind CSS v4)

- `src/styles/tokens.css` — `@import "tailwindcss"` plus the `@theme {}` design tokens (colours, fonts,
  radii, shadows). The single source of tokens: never put raw hex values in components; use the
  utilities (`text-[var(--color-primary)]`, `font-sans`…) or `var(--color-…)`.
- `src/styles/global.css` — base reset; import **after** the tokens.

### How an app imports them (T-015)

Each app has one CSS entry, `src/app/globals.css`, imported once by its root layout:

```css
@import "@igs/ui/styles/tokens.css"; /* Tailwind + tokens */
@import "@igs/ui/styles/global.css";
@source "../../../../packages/ui/src"; /* classes used in shared components */
```

and runs Tailwind through PostCSS (`postcss.config.mjs` with `@tailwindcss/postcss`, pinned to the same
version as `tailwindcss`). Tailwind scans the app automatically; `@source` adds this package, so a class
that only appears in `packages/ui` is still generated.

- **Fonts:** `--font-sans` names Inter; the web app's `next/font` sets the same variable on `<html>`
  (unlayered, so it wins over Tailwind's `@layer theme` value) and `font-sans` resolves to the
  self-hosted Inter.
- **Check:** `pnpm check:csp` asserts that the generated stylesheet contains utilities, and
  `pnpm --filter @igs/e2e smoke` checks computed styles in the production build.
