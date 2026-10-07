# 0010 — NL / FR / DE / EN from day one

- Status: Proposed
- Date: 2026-10-07

## Context
Belgium has three official languages; product information must be available in the language of
the customer's region; English helps expats in Brussels.

## Decision
- **next-intl** with locale-prefixed routes: `/nl-be`, `/fr-be`, `/de-be`, `/en` (short form `/nl`,
  `/fr`, `/de`, `/en` acceptable) and `hreflang` alternates.
- UI strings in ICU message files per locale; product/CMS content per locale in DB.
- Fallback rules: missing product content in requested locale → show available official language
  with a notice; **medicine leaflets never machine-translated**.
- Translated slugs per locale for SEO.
- E-mails, invoices, PDFs, SMS in the customer's chosen locale.

## Consequences
- ✅ No painful retrofit; SEO in all language markets.
- ⚠️ Content operations cost (translation workflow in Payload; professional translation for legal texts).
