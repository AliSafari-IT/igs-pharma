# IGS-Pharma — Documentation

> Master plan for a **healthcare-grade online pharmacy webshop** (Belgium) coupled with a
> **pharmacy management platform** (inventory, orders, patients, prescriptions, auth).
>
> - **Phase 1:** compliant online pharmacy for OTC / non-prescription products.
> - **Phase 2:** prescription medicines & healthcare workflows.
>
> Plan date: **7 October 2026** · Status: **Draft v1, for review**

---

## Where to start

| If you are… | Read |
|---|---|
| Owner / pharmacist-titular | [00 Executive summary](00-executive-summary.md) → [Roadmap](01-strategy/roadmap.md) → [Regulatory framework](02-compliance/regulatory-framework-belgium.md) → [Open questions](01-strategy/open-questions-and-assumptions.md) |
| Architect / tech lead | [Architecture overview](03-architecture/architecture-overview.md) → [Tech stack](03-architecture/tech-stack.md) → [ADRs](03-architecture/adr/README.md) → [Domain model](03-architecture/domain-model.md) |
| Developer | [Repository structure](06-engineering/repository-structure.md) → [Development workflow](06-engineering/development-workflow.md) → [Design system](05-design/design-system.md) |
| Designer | [Design system](05-design/design-system.md) → [UX & content guidelines](05-design/ux-and-content-guidelines.md) |
| Compliance / DPO | [Regulatory framework](02-compliance/regulatory-framework-belgium.md) → [Requirements matrix](02-compliance/compliance-requirements-matrix.md) → [GDPR & privacy](02-compliance/gdpr-and-privacy.md) → [Security architecture](03-architecture/security-architecture.md) |

## Folder map

```
docs/
├── README.md                          ← you are here
├── 00-executive-summary.md            ← one-page plan, key decisions, timeline
├── 01-strategy/
│   ├── vision-and-scope.md            ← goals, non-goals, success metrics
│   ├── roadmap.md                     ← phases, milestones, gates
│   └── open-questions-and-assumptions.md
├── 02-compliance/
│   ├── regulatory-framework-belgium.md    ← laws & authorities (BE + EU)
│   ├── compliance-requirements-matrix.md  ← REQ-IDs traced to features/tests
│   └── gdpr-and-privacy.md                ← health data, DPIA, retention
├── 03-architecture/
│   ├── architecture-overview.md       ← modular monolith, C4 diagrams
│   ├── tech-stack.md                  ← every tool, with rationale
│   ├── domain-model.md                ← bounded contexts, core entities
│   ├── integrations.md                ← PSP, carriers, Medipim, LGO, eHealth…
│   ├── security-architecture.md       ← auth, RBAC, audit, encryption
│   └── adr/                           ← Architecture Decision Records
├── 04-product/
│   ├── phase-1-otc-webshop.md         ← storefront features & order flow
│   ├── pharmacy-platform-backoffice.md← staff platform features
│   └── phase-2-prescriptions-and-care.md
├── 05-design/
│   ├── design-system.md               ← tokens, contrast, type, components
│   └── ux-and-content-guidelines.md   ← trust patterns, tone, a11y, i18n
├── 06-engineering/
│   ├── repository-structure.md        ← monorepo layout
│   └── development-workflow.md        ← standards, testing, CI/CD, envs
├── 07-operations/
│   ├── infrastructure-and-hosting.md  ← EU hosting, environments, cost
│   └── observability-and-incident-response.md ← monitoring, backups, BCP
└── 08-project/
    ├── team-budget-and-delivery.md    ← team, effort, budget ranges
    └── risk-register.md
```

## Conventions

- **Requirement IDs** — compliance requirements use `REQ-<AREA>-<NN>` (e.g. `REQ-WEB-03`) and are
  referenced from features, ADRs and tests.
- **ADRs** — any decision that is costly to reverse gets an ADR in `03-architecture/adr/`
  (status: *Proposed → Accepted → Superseded*).
- **Legal disclaimer** — the compliance documents are an engineering interpretation to drive the
  build. They are **not legal advice** and must be validated by Belgian healthcare counsel, the
  FAMHP / AFMPS / FAGG and the Order of Pharmacists before launch. Items marked
  **⚖️ verify** need explicit legal confirmation.
- **Living documents** — update the doc in the same PR as the code that changes the behaviour.
