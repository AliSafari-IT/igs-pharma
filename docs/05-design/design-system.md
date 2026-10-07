# Design System — "Swiss Pharmacy"

**Modern healthcare + premium wellness + trustworthy commerce.**
Calm, precise, generous white space, editorial typography, warm accents. The opposite of the
cluttered "green cross + hospital blue" pharmacy website.

## 1. Brand principles

| Principle | Means | Avoid |
|---|---|---|
| **Calm confidence** | Plenty of white, one clear action per view, quiet motion | Flashing promo banners, red "SALE" everywhere |
| **Swiss precision** | Strict grid, consistent spacing, clear hierarchy, tabular numbers for prices | Random font sizes, centred walls of text |
| **Warm expertise** | Real pharmacist faces & names, amber "pharmacist tip" moments, human copy | Stock photos of pills and lab coats, clinical jargon |
| **Honest commerce** | Clear prices incl. VAT, delivery cost visible early, no dark patterns | Fake urgency, pre-ticked boxes, hidden fees |
| **Accessible by default** | AA contrast, large touch targets, readable at 200 % zoom | Grey-on-grey text, icon-only buttons without labels |

## 2. Colour

### 2.1 Core palette (as specified)

| Token | Hex | Role |
|---|---|---|
| `--color-primary` | `#0F766E` Deep Teal | Primary buttons, links, active states, key brand surfaces |
| `--color-secondary` | `#14B8A6` Fresh Teal | Accents, illustrations, progress, decorative highlights |
| `--color-accent` | `#F59E0B` Warm Amber | "Pharmacist tip", badges, ratings, small highlights |
| `--color-bg` | `#FFFFFF` | Page background |
| `--color-surface` | `#F8FAFC` | Cards, sections, inputs background (alt) |
| `--color-border` | `#E2E8F0` | Dividers, card borders (decorative) |
| `--color-text` | `#0F172A` | Body & headings |
| `--color-text-muted` | `#64748B` | Secondary text, meta |
| `--color-success` | `#16A34A` | Success icons, fills |
| `--color-error` | `#DC2626` | Error icons, borders, text on white |

> Nice detail: these map exactly to Tailwind's `teal-700`, `teal-500`, `amber-500`, `slate-*`,
> `green-600` and `red-600`, so the full Tailwind scales can be used for tints and shades.

### 2.2 Measured contrast (WCAG 2.2) — and the resulting rules

| Pair | Ratio | Verdict |
|---|---|---|
| Deep Teal `#0F766E` on white | **5.47** | ✅ AA text, ✅ white text on teal buttons |
| Deep Teal on Surface `#F8FAFC` | 5.23 | ✅ AA |
| Fresh Teal `#14B8A6` on white | **2.49** | ❌ **Never for text, links or icons that carry meaning** |
| White on Fresh Teal | 2.49 | ❌ **No white text on Fresh Teal** |
| Text `#0F172A` on Fresh Teal | 7.17 | ✅ Dark text on Fresh Teal is fine |
| Amber `#F59E0B` on white | **2.15** | ❌ **Never as text colour** |
| Text `#0F172A` on Amber | 8.31 | ✅ Amber chips/badges always with dark text |
| Muted `#64748B` on white | 4.76 | ✅ AA |
| Muted on Surface `#F8FAFC` | 4.55 | ✅ AA (just) |
| Muted on `#F1F5F9` (slate-100) | 4.34 | ❌ → use `#475569` (slate-600, 7.24) on slate-100 |
| Success `#16A34A` on white | **3.30** | ⚠️ Icons/large text only → success **text** uses `#15803D` (5.02) |
| Error `#DC2626` on white | 4.83 | ✅ AA |
| Error `#DC2626` on red-50 `#FEF2F2` | 4.41 | ❌ → error text on tinted bg uses `#B91C1C` (5.91) |
| Border `#E2E8F0` on white | 1.23 | ⚠️ Decorative only. **Form-control borders** need ≥ 3:1 → use `#64748B` (4.76) or slate-500 |
| Hover primary `#115E59` with white text | 7.58 | ✅ |

**Golden rules**
1. Text is `text`, `text-muted` or `primary` — never `secondary` or `accent`.
2. Coloured buttons: **Deep Teal with white text** (primary) or **Amber with dark text** (rare
   highlight CTA, e.g. "Ask a pharmacist").
3. Fresh Teal and Amber are **light** colours — always pair with dark text.
4. Never encode meaning by colour alone (add icon + text).

### 2.3 Semantic tokens

```css
/* packages/ui/src/styles/tokens.css — Tailwind CSS v4 */
@import "tailwindcss";

@theme {
  /* Brand */
  --color-primary: #0F766E;          /* teal-700 */
  --color-primary-hover: #115E59;    /* teal-800 */
  --color-primary-active: #134E4A;   /* teal-900 */
  --color-primary-subtle: #F0FDFA;   /* teal-50  – tinted sections, selected rows */
  --color-primary-muted: #CCFBF1;    /* teal-100 – chips, highlights (dark text) */
  --color-secondary: #14B8A6;        /* teal-500 – decorative only */
  --color-accent: #F59E0B;           /* amber-500 – with dark text */
  --color-accent-subtle: #FFFBEB;    /* amber-50 – pharmacist tip background */
  --color-accent-strong: #92400E;    /* amber-800 – text on amber-50 (6.84:1) */

  /* Neutrals */
  --color-bg: #FFFFFF;
  --color-surface: #F8FAFC;          /* slate-50 */
  --color-surface-2: #F1F5F9;        /* slate-100 */
  --color-border: #E2E8F0;           /* slate-200 – decorative */
  --color-border-strong: #64748B;    /* slate-500 – inputs, ≥3:1 */
  --color-text: #0F172A;             /* slate-900 */
  --color-text-muted: #64748B;       /* slate-500 – on white/surface only */
  --color-text-subtle: #475569;      /* slate-600 – muted text on surface-2 */
  --color-focus: #0F766E;

  /* Feedback */
  --color-success: #16A34A;          /* icons/fills */
  --color-success-text: #15803D;     /* green-700 */
  --color-success-subtle: #F0FDF4;
  --color-error: #DC2626;
  --color-error-text: #B91C1C;       /* on tinted backgrounds */
  --color-error-subtle: #FEF2F2;
  --color-warning: #F59E0B;
  --color-warning-text: #92400E;
  --color-info: #0F766E;

  /* Typography */
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Fraunces Variable", ui-serif, Georgia, serif;

  /* Radius & shadow */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --shadow-card: 0 1px 2px rgb(15 23 42 / 0.04), 0 4px 16px rgb(15 23 42 / 0.06);
  --shadow-pop: 0 8px 32px rgb(15 23 42 / 0.12);
}
```

### 2.4 Usage ratio
Roughly **70 % white/surface · 20 % text neutrals · 8 % Deep Teal · 2 % Fresh Teal + Amber**.
Amber is a spice, not a sauce.

### 2.5 Dark mode
Not required for the storefront at launch (healthcare imagery & product photos are designed for
light). The **back-office** may offer dark mode later; tokens are already semantic, so it's a
token swap (`primary` → `teal-400 #2DD4BF` on `slate-900`, 9.59:1).

## 3. Typography

| Role | Font | Size / line-height (mobile → desktop) | Weight |
|---|---|---|---|
| Display (hero) | **Fraunces** (soft editorial serif — the "premium wellness" touch) | 36/44 → 56/64 | 500 |
| H1 | Inter | 30/38 → 40/48 | 650 |
| H2 | Inter | 24/32 → 30/38 | 650 |
| H3 | Inter | 20/28 → 22/30 | 600 |
| Body | Inter | 16/26 | 400 |
| Small / meta | Inter | 14/22 | 400–500 |
| Price | Inter, `font-variant-numeric: tabular-nums` | 18–24 | 650 |
| Legal / leaflet | Inter | 15/24 | 400 |

- Self-hosted with `next/font/local` (GDPR: no Google CDN calls). Subsets: Latin + Latin-ext
  (accents for FR/DE/NL).
- Max line length 70ch; never justify text; sentence case headings.
- Alternatives if Fraunces feels too soft: **Newsreader** or **Instrument Serif**; all-sans option:
  **Manrope** for headings.

## 4. Layout & spacing

- 4-pt base, 8-pt rhythm: spacing scale `4, 8, 12, 16, 24, 32, 48, 64, 96`.
- Grid: 4 cols (mobile) / 8 (tablet) / 12 (desktop), max content width 1280 px, gutters 16/24/32.
- Breakpoints: `sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`.
- Touch targets ≥ 44 × 44 px (WCAG 2.5.8 minimum is 24 px — we exceed it).

## 5. Iconography & imagery

- Icons: **Lucide** (1.5 px stroke, rounded), sized 20/24. No green crosses as decoration — the
  official pharmacy cross only where legally/brand meaningful (e.g. store photo, pharmacy page).
- Photography: natural light, real people, real pharmacy team, products on soft neutral or teal-50
  backgrounds, consistent 4:5 product crops on white.
- Illustrations: minimal line art in Deep Teal + Fresh Teal fills + Amber details.
- Product images: white background, centred, consistent padding; `next/image` with AVIF/WebP.

## 6. Components (shadcn/ui-based, in `packages/ui`)

| Component | Notes |
|---|---|
| Button | `primary` (teal, white text), `secondary` (white, teal border/text), `ghost`, `accent` (amber, dark text), `destructive`; sizes `sm/md/lg`; loading state |
| Input / Select / Checkbox / Radio | 44 px height, `border-strong`, visible label always, inline error with icon |
| Product card | Image, brand, name (2 lines), price incl. VAT, availability dot+text, medicine badge "Medicine" (neutral), add-to-cart |
| Medicine notice | Surface block with info icon, mandatory text, leaflet link |
| Pharmacist tip | `accent-subtle` background, amber left bar, pharmacist avatar + name |
| Trust bar | "Licensed Belgian pharmacy · Orders checked by a pharmacist · Delivered in 1–2 days · Secure payment" |
| EU common logo | Official asset, never recoloured, links to FAMHP list |
| Quantity stepper | Shows limit messaging ("Max. 2 per order for your safety") |
| Questionnaire | One question per step on mobile, plain language, "Why do we ask?" disclosure |
| Order status timeline | Includes "Pharmacist review" step |
| Badges | Neutral (slate), success, warning (amber w/ dark text), info (teal-50) |
| Toast / alert | Icon + text; error alerts persistent until resolved |
| Data table (platform) | Dense mode, sticky header, column visibility, keyboard nav |
| Command palette (platform) | `⌘K` search across orders, products, customers |

## 7. Motion

- 150–250 ms ease-out for UI; respect `prefers-reduced-motion`.
- No auto-rotating carousels on the home page (accessibility + conversion).

## 8. Focus & states

- Focus ring: 2 px `--color-focus` + 2 px white offset (visible on all backgrounds).
- Disabled: 50 % opacity **plus** `cursor-not-allowed` and an explanation where helpful.
- Error states never rely on red alone.

## 9. Deliverables (Phase 0)

- [ ] Figma library mirroring these tokens (variables) and components.
- [ ] Logo & wordmark for IGS-Pharma (teal wordmark, optional amber dot detail).
- [ ] Key screens: home, PLP, PDP (medicine + cosmetic), cart, checkout (with questionnaire),
      account, order status, pharmacy page; platform: dashboard, review queue, pick/pack.
- [ ] Storybook in `packages/ui` with a11y addon; token file generated from Figma variables
      (Style Dictionary or Tokens Studio).
