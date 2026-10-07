# 00 — Executive Summary

## The idea in one paragraph

IGS-Pharma builds **one platform with two faces**: a premium, trustworthy **webshop** for
Belgian consumers and a **pharmacy operations platform** for the pharmacy team. From day one it
is engineered as a **healthcare-grade system** — audit trails, pharmacist-in-the-loop order
validation, health-data-ready security and EU-only data residency — even though Phase 1 only
sells non-prescription products. That way Phase 2 (prescriptions and care services) is an
*extension* of the platform, not a rewrite.

## Your instinct is right: build healthcare-grade from day one

Even OTC-only, the shop processes **health data**:

- buying a pregnancy test, a laxative or nicotine gum reveals health information
  (GDPR Art. 9 "special category" data),
- OTC **medicines** need pharmacist oversight (counselling, quantity limits, contraindication
  questionnaires),
- the site must be legally linked to a physical pharmacy and registered with the FAMHP.

Retrofitting audit logs, consent, encryption and role-based access later costs far more than
building them in at the start. The extra up-front cost is about **10–15 % of Phase 1 effort**.

## A critical reality check for Phase 2

Under **current Belgian law, prescription-only medicines cannot be sold remotely and shipped**.
So "Phase 2 = prescriptions" is designed as:

1. **e-Prescription reservation** — the patient shares the prescription ID (RID) or their national
   number; the pharmacy prepares; the patient picks up and pays in the pharmacy (*click & reserve*).
2. **Care workflows** — reference pharmacist (*huisapotheker / pharmacien de référence*),
   medication schedules, refill reminders, appointment booking (vaccinations, medication reviews),
   secure pharmacist messaging.
3. **Home delivery of Rx** only within whatever exceptions the law allows at that time
   (a ⚖️ legal gate before Phase 2 build).

Dispensing, reimbursement (*tarification* / third-party payer) and the shared pharmaceutical
record (GFD / DPP) require **certified (homologated) pharmacy software**. The plan is to
**integrate with the pharmacy's certified dispensing software (LGO)**, not to rebuild it. See
[ADR-0008](03-architecture/adr/0008-integrate-certified-lgo-for-dispensing.md).

## Key decisions (summary)

| Topic | Decision | ADR |
|---|---|---|
| Architecture | **Modular monolith** in a TypeScript monorepo — not microservices | [0001](03-architecture/adr/0001-modular-monolith.md) |
| Front-end | **Next.js (App Router, latest stable 16.x)** — two apps: `web` (shop) and `platform` (back-office) | [0002](03-architecture/adr/0002-nextjs-monorepo-two-apps.md) |
| Database | **PostgreSQL** (single cluster, schema per module) + **Drizzle ORM** | [0003](03-architecture/adr/0003-postgresql-drizzle.md) |
| Auth | **Better Auth** (self-hosted, data in our Postgres); passkeys + MFA for staff; **itsme®** identity proofing in Phase 2 | [0004](03-architecture/adr/0004-better-auth.md) |
| Hosting | **EU-sovereign cloud** (recommended: Scaleway or OVHcloud), all data in the EU | [0005](03-architecture/adr/0005-eu-sovereign-hosting.md) |
| Async work | **Postgres-backed jobs + transactional outbox** (no Kafka/Redis needed at this scale) | [0006](03-architecture/adr/0006-postgres-jobs-and-outbox.md) |
| Commerce | **Own commerce core** in the monolith (pharmacy rules run through the whole order lifecycle) | [0007](03-architecture/adr/0007-own-commerce-core.md) |
| Rx dispensing | **Integrate the certified LGO**; do not rebuild homologated functions | [0008](03-architecture/adr/0008-integrate-certified-lgo-for-dispensing.md) |
| Catalogue | **CNK** as Belgian product identity; product content from **Medipim** + **SAM** | [0009](03-architecture/adr/0009-cnk-product-identity-and-catalogue-sources.md) |
| Languages | **nl-BE, fr-BE, de-BE, en** from day one | [0010](03-architecture/adr/0010-multilingual-from-day-one.md) |

## Brand direction — "Swiss Pharmacy"

Modern healthcare + premium wellness + trustworthy commerce. No green crosses, no hospital blue.

| Role | Colour | Rule of use |
|---|---|---|
| Primary | `#0F766E` Deep Teal | Buttons, links, key UI — passes WCAG AA with white text (5.47:1) |
| Secondary | `#14B8A6` Fresh Teal | Accents, illustrations, highlights — **never as text or as background for white text** (2.49:1) |
| Accent | `#F59E0B` Warm Amber | Badges, "pharmacist tip", ratings — **always with dark text** (8.31:1) |
| Success | `#16A34A` | Icons/fills; use `#15803D` for success **text** |

Full details: [Design system](05-design/design-system.md).

## Timeline at a glance

```mermaid
gantt
    dateFormat  YYYY-MM-DD
    title IGS-Pharma high-level timeline (indicative)
    section Phase 0
    Discovery, legal & design          :p0, 2026-10-19, 6w
    section Phase 1 — OTC webshop
    Foundation (platform core)         :p1a, after p0, 8w
    Commerce MVP                       :p1b, after p1a, 10w
    Hardening, pen-test, FAMHP notice  :p1c, after p1b, 5w
    Go-live OTC                        :milestone, m1, after p1c, 0d
    section Phase 1.5
    Click & collect, loyalty, B2B, search+ :p15, after p1c, 10w
    section Phase 2 — Rx & care
    Legal gate + LGO integration study :p2g, after p1c, 6w
    Rx reservation & care workflows    :p2, after p2g, 20w
```

Indicative: **OTC go-live ≈ 7 months after kickoff**, **Phase 2 ≈ 6–8 months after go-live**,
with a team of ~4–6 people. See [Roadmap](01-strategy/roadmap.md) and
[Team, budget & delivery](08-project/team-budget-and-delivery.md).

## Top 5 risks

1. **Regulatory misinterpretation** (online-sale rules, medicine advertising, discounts) → legal review at Phase 0 and before each go-live.
2. **LGO vendor integration** (APIs may be closed or slow to obtain) → start vendor talks in Phase 0.
3. **Stock accuracy** between shop and physical pharmacy → single stock ledger, reservations, sync SLAs.
4. **Health-data breach** → defense-in-depth security, pen-test, minimal data collection.
5. **Scope creep** into "rebuilding pharmacy software" → strict ADR-0008 boundary.

Full list: [Risk register](08-project/risk-register.md).

## Next 10 working days

1. Answer the [open questions](01-strategy/open-questions-and-assumptions.md) (pharmacy licence, LGO vendor, language region, team).
2. Book Belgian healthcare counsel + DPO for a scoping session.
3. Contact the LGO vendor about integration APIs / partner programme.
4. Request Medipim and PSP (Mollie / Adyen / Stripe) commercial terms; confirm pharmacy acceptance.
5. Open accounts with the chosen EU cloud; set up repo, CI and environments ([Phase 0 checklist](01-strategy/roadmap.md#phase-0--discovery-legal--design-6-weeks)).
