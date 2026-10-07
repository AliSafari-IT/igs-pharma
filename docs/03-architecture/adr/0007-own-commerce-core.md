# 0007 — Own commerce core instead of a commerce platform

- Status: Proposed
- Date: 2026-10-07

## Context
Pharmacy rules permeate the order lifecycle: pharmacist review states, quantity limits per
substance and period, questionnaires, promotions excluding medicines, stock shared with a
physical pharmacy and an LGO, health-data encryption and audit, Phase 2 reservations.

## Decision
Implement the commerce domain (catalogue, pricing/tax, cart, checkout, orders, payments,
fulfilment) as **modules of our monolith**, using proven libraries (PSP SDK, Sendcloud, PDF,
e-mail) rather than a full commerce engine.

## Consequences
- ✅ One data model, one transaction, one audit trail; pharmacy logic is first-class.
- ✅ No impedance mismatch between commerce engine and pharmacy platform.
- ⚠️ We build standard features ourselves (promotions, returns, invoices) — scoped carefully.

## Alternatives considered
- **Medusa v2** (TS, Postgres, modular) — strongest alternative; would be a second system with its
  own data model to keep in sync with the pharmacy platform. Re-evaluate in Phase 0 spike (2 days)
  if the team prefers it.
- **Shopify / commercetools / Saleor** — SaaS or separate stack; health data and medicine rules
  fight the platform; data residency issues.
