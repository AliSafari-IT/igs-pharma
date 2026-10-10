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

- **Fonts:** see [Fonts](#fonts-t-017) below. `next/font` sets `--font-sans` / `--font-display` on
  `<html>` (unlayered, so it wins over Tailwind's `@layer theme` value).
- **Check:** `pnpm check:csp` asserts that the generated stylesheet contains utilities, and
  `pnpm --filter @igs/e2e smoke` checks computed styles in the production build.

## Fonts (T-017)

Inter (body, `font-sans`) and Fraunces (display, `font-display`) are **self-hosted**: committed WOFF2
files in `src/fonts/`, loaded with `next/font/local` from `src/fonts.ts` (`@igs/ui/fonts`). Both apps
put the two `.variable` classes on `<html>`:

```tsx
import { fontDisplay, fontSans } from "@igs/ui/fonts";
<html className={`${fontSans.variable} ${fontDisplay.variable}`}>
```

The build needs no network (unlike `next/font/google`), and the files are served from
`/_next/static/media` under the unchanged `font-src 'self'`. The smoke test asserts that no request
leaves the origin.

| File | Upstream | Axes kept | Licence |
|---|---|---|---|
| `InterVariable-latin-ext.woff2` | [rsms/inter v4.1](https://github.com/rsms/inter/releases/tag/v4.1), `InterVariable.ttf` | `opsz` 14–32, `wght` 100–900 | `OFL-Inter.txt` |
| `Fraunces-latin-ext.woff2` | [undercasetype/Fraunces 1.000](https://github.com/undercasetype/Fraunces/releases/tag/1.000), `Fraunces[SOFT,WONK,opsz,wght].ttf` | `opsz` 9–144, `wght` 100–900 (`SOFT`=0, `WONK`=0 pinned) | `OFL-Fraunces.txt` |

Both are subset to Latin + Latin Extended (nl/fr/de/en, plus `€` and the narrow no-break space that
`Intl` puts in `fr-BE` prices), with fonttools 4.55.3:

```bash
pip install fonttools==4.55.3 brotli==1.1.0
U="U+0000-024F,U+0259,U+02BB-02BC,U+02C6-02DD,U+0300-036F,U+1E00-1EFF,U+2000-206F,U+20A0-20C0,U+2113,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD"
pyftsubset InterVariable.ttf --unicodes="$U" --layout-features+=tnum,case \
  --flavor=woff2 --output-file=InterVariable-latin-ext.woff2
fonttools varLib.instancer "Fraunces[SOFT,WONK,opsz,wght].ttf" SOFT=0 WONK=0 -o Fraunces-opsz-wght.ttf
pyftsubset Fraunces-opsz-wght.ttf --unicodes="$U" --layout-features+=tnum,case \
  --flavor=woff2 --output-file=Fraunces-latin-ext.woff2
```

`tnum` is kept for `Price` (`tabular-nums`).

## Components (T-017)

All exported from `@igs/ui`: `Button`, `Link`, `Input`, `Label`, `FieldError`, `TextField`, `Badge`,
`Alert`, `Price` (+ `formatPrice`), `VisuallyHidden`, `Container`, `Stack`. See them all at platform
`/dev/ui` (on in `next dev`; a 404 in production unless `UI_GALLERY=on`).

### Contrast is enforced in code

- Each variant declares the token pairs it draws in a typed **contrast manifest**
  (`buttonContrast`, `badgeContrast`, …; types in `src/contrast.ts`). The text-colour type has no
  `secondary` (Fresh Teal), `accent`/`warning` (Amber), `success` or `border`, so those can't be
  declared as text.
- `src/contrast.test.ts` reads the colours from `tokens.css` (the single source), and fails if a pair
  is below WCAG AA (4.5 for text, 3 for large text and UI parts such as borders and the focus ring),
  if a variant's classes don't use the tokens its manifest claims, or if the token list drifts.
- Amber (`Button variant="accent"`, `Badge variant="amber"`) always carries the dark text colour; no
  prop changes it.
- An icon-only `Button` (`iconOnly`) does not type-check without `aria-label`.

### Rules for `className`

`className` is for **layout only** (margin, width, grid placement). **Never set a colour through
`className`** (`text-*`, `bg-*`, `border-*` colours): types can't police free-form class strings, so
this is a review rule, backed by axe on the gallery and the storefront home page
(`pnpm --filter @igs/e2e smoke`, after `pnpm build`). A new colour need is a new variant with its
manifest entry.

### Tests

`pnpm --filter @igs/ui test`: the contrast test, plus rendering/ARIA tests with
`react-dom/server` in Node (no DOM library): roles, `aria-invalid`, the `aria-describedby` ↔ `id`
wiring, `aria-busy` while loading, `Price` per locale.
