# Team, Budget & Delivery

> All numbers are **planning estimates** to support decisions — refine after Phase 0.

## 1. Team

| Role | Phase 0 | Phase 1 | Phase 2 | Notes |
|---|---|---|---|---|
| Product owner (pharmacist-titular or delegate) | 0.5 | 0.5 | 0.5 | Decides scope, approves rules & medicine content, legal accountability |
| Tech lead / architect (senior full-stack TS) | 1 | 1 | 1 | Owns architecture, security, DevOps at this scale |
| Full-stack developers (Next.js/TS/Postgres) | 0–1 | 2 | 2 | One with commerce/payments experience |
| UX/UI designer | 1 | 0.5 | 0.5 | Design system, key flows, usability tests |
| QA / test automation | — | 0.5 | 0.5 | Playwright, accessibility, UAT coordination |
| Content & translation | 0.25 | 0.5 | 0.25 | Copywriter + translators NL/FR/DE |
| DPO (external) | ad hoc | ad hoc | ad hoc | DPIA, RoPA, sign-offs |
| Healthcare legal counsel (external) | ad hoc | ad hoc | ad hoc | Opinions at gates |
| Pen-tester (external) | — | 1 engagement | 1 engagement | |
| **Core FTE** | **~3** | **~5** | **~4.5** | |

## 2. Effort estimate

| Phase | Duration | Core FTE | Person-weeks |
|---|---|---|---|
| 0 Discovery | 6 wks | ~3 | ~18 |
| 1a Foundation | 8 wks | ~4.5 | ~36 |
| 1b Commerce MVP | 10 wks | ~5 | ~50 |
| 1c Hardening & launch | 5 wks | ~5 | ~25 |
| **Phase 1 total** | **~29 wks (≈ 7 months)** | | **~130** |
| 1.5 Growth | 10 wks | ~3.5 | ~35 |
| Gate 2 feasibility | 6 wks (parallel) | ~1 | ~6 |
| 2 Rx & care | 20 wks | ~4.5 | ~90 |

## 3. Budget ranges (excl. VAT)

| Item | Phase 1 | Phase 2 |
|---|---|---|
| Build team (blended €600–850/day, freelance/agency in BE) | €330k – €550k | €240k – €380k |
| Build team (mostly in-house salaries) | ~40–50 % lower cash cost | idem |
| Design & brand (logo, photography of team/pharmacy) | €15k – €40k | €5k – €15k |
| Legal counsel & DPO setup | €10k – €30k | €10k – €25k |
| Pen-test | €8k – €20k | €10k – €25k |
| Translations (UI + legal + launch content) | €8k – €20k | €5k – €10k |
| Infra (see hosting doc) | €400 – €1.25k / month | +€200 – €500 / month |
| SaaS (Medipim, Sendcloud, e-mail, monitoring) | quotes in Phase 0 | + itsme® per-use fees |

### Lean alternative ("MVP-lite", ~4.5 months, 3 people)
Cut to: NL + FR only at launch, no CMS (MDX content in repo), Postgres search only, Sendcloud
only, Mollie only, review queue + simple fulfilment, manual LGO stock import. Keeps **all
compliance MUSTs and healthcare-grade foundations** (auth, audit, encryption, RBAC). Roughly
**€180k – €280k**. Add the rest in Phase 1.5.

## 4. Governance & rituals

- 2-week sprints; sprint review with pharmacy team (demo on staging).
- Monthly steering: owner, pharmacist-titular, tech lead (+ DPO quarterly): scope, budget, risks.
- Gate reviews per [roadmap](../01-strategy/roadmap.md) with written sign-off.
- Decision log = ADRs + this docs folder.

## 5. Phase 0 — detailed 6-week plan

| Week | Activities |
|---|---|
| 1 | Kick-off; answer [open questions](../01-strategy/open-questions-and-assumptions.md); legal & DPO briefing; LGO vendor contact; cloud accounts; repo + CI skeleton |
| 2 | Process mapping (current counter & stock processes); requirements workshop with pharmacists; Medipim/PSP/carrier demos |
| 3 | Brand & design exploration (2 directions within the Swiss Pharmacy palette); DPIA draft; walking skeleton (auth + DB + deploy) |
| 4 | Key screens hi-fi; LGO integration spike; ADRs accepted; threat modelling workshop |
| 5 | Usability test of prototype; legal opinion draft review; backlog for Phase 1 estimated |
| 6 | Gate 0 review; plan & budget confirmed; Phase 1 sprint 1 ready |
