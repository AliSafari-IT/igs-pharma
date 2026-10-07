# Vision & Scope

## Vision

> **"The pharmacy you trust, now as easy as your favourite online shop."**

IGS-Pharma brings the advice, safety and accountability of a Belgian community pharmacy online,
with the experience quality of a premium wellness retailer. Every order containing a medicine is
seen by a pharmacist; every interaction is private by design.

## Positioning

| Typical pharmacy site | IGS-Pharma |
|---|---|
| Cold, clinical, cluttered with green crosses and medical blue | Calm, premium, deep teal + warm amber, lots of white space |
| Discount-driven, "promo" banners everywhere | Advice-driven: pharmacist tips, clear usage info, honest pricing |
| Generic product data | Curated, multilingual product content, leaflet always one click away |
| Anonymous fulfilment | Named pharmacist validation, visible pharmacy identity and licence |
| Separate, disconnected systems | One platform: shop, stock, patients, care services |

## Goals

### Business goals
- **G1** Launch a legally compliant OTC webshop in Belgium within ~7 months of kickoff.
- **G2** Make online a meaningful channel (target to be set in Phase 0: e.g. X % of OTC revenue in year 1).
- **G3** Increase loyalty of local patients via click & collect and care services (Phase 1.5/2).
- **G4** Reduce staff time per order via a smart back-office (pick lists, review queues, labels).

### Product goals
- **P1** Conversion-grade UX: fast (Core Web Vitals "good"), mobile-first, accessible (WCAG 2.2 AA).
- **P2** Trust signals everywhere: licence data, pharmacist validation, EU common logo, privacy.
- **P3** Multilingual NL / FR / DE / EN with legally correct product information per language.

### Technical goals
- **T1** Healthcare-grade foundations: audit, RBAC, encryption, EU residency, backups tested.
- **T2** Modular monolith that a small team can operate, with clean seams for Phase 2.
- **T3** Single source of truth for stock and orders; no double-selling.

## Scope

### Phase 1 — In scope
- Storefront: catalogue (OTC medicines, medical devices, food supplements, cosmetics/dermo,
  baby & mother, hygiene, wellness), search, product pages, cart, checkout, accounts.
- Pharmacist validation of orders containing medicines (rules + review queue + questionnaires).
- Payments (Bancontact, cards, Apple/Google Pay, Wero/Payconiq where available, bank transfer).
- Delivery in Belgium (carrier + optionally own courier) and pickup at the pharmacy.
- Back-office: catalogue, pricing, stock, orders, fulfilment, customers, content (CMS), reports.
- Compliance: FAMHP-registered site, EU common logo, legal pages, GDPR tooling, audit.

### Phase 2 — In scope (subject to legal gate)
- e-Prescription reservation & pickup flow; integration with the certified LGO.
- Patient profiles with consent, medication overview (from LGO/GFD where permitted).
- Care services: appointment booking, reference pharmacist, refill reminders, secure messaging.
- Strong identity (itsme® / eID) for patient health features.

### Explicit non-goals (for now)
- ❌ Shipping prescription-only medicines (not allowed in Belgium today).
- ❌ Rebuilding homologated dispensing / tarification software ([ADR-0008](../03-architecture/adr/0008-integrate-certified-lgo-for-dispensing.md)).
- ❌ Selling outside Belgium (cross-border sale must follow destination-country law).
- ❌ Veterinary medicines (separate EU Reg. 2019/6 regime) — revisit later.
- ❌ Marketplace / third-party sellers.
- ❌ AI-generated medical advice. AI may assist search and staff, never replace the pharmacist.

## Success metrics (to baseline in Phase 0)

| Metric | Target (initial proposal) |
|---|---|
| Conversion rate | ≥ 2.5 % after 6 months |
| Median pharmacist review time (business hours) | ≤ 30 min |
| Order → shipped (business days) | Same day if ordered before 14:00 |
| Stock accuracy (web vs physical) | ≥ 99 % |
| Oversell / cancellation due to stock | < 0.5 % of orders |
| Core Web Vitals (p75 mobile) | LCP < 2.5 s, INP < 200 ms, CLS < 0.1 |
| Accessibility | 0 critical axe violations; annual manual WCAG 2.2 AA audit |
| Availability (storefront) | 99.9 % monthly |
| Security | 0 high/critical pen-test findings open at launch |
| NPS / review score | ≥ 4.6 / 5 |
