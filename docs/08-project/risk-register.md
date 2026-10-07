# Risk Register

Scale: Likelihood (L) and Impact (I) 1–5; Score = L × I. Review monthly in steering.

| ID | Risk | L | I | Score | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R01 | Misinterpretation of Belgian online-pharmacy / advertising rules leads to non-compliant launch or sanctions | 3 | 5 | 15 | Legal opinion in Phase 0 and before each gate; compliance matrix with tests; conservative defaults (medicines excluded from promos, no reviews) | Pharmacist-titular |
| R02 | LGO vendor offers no/slow API → stock inaccuracy and Phase 2 blocked | 4 | 4 | 16 | Early vendor engagement; adapter with file-based fallback; safety buffers; consider vendor change in long term | Tech lead |
| R03 | Health-data breach | 2 | 5 | 10 | Security architecture, MFA, encryption, least privilege, pen-tests, monitoring, breach drill | Tech lead + DPO |
| R04 | Overselling between web and walk-in customers | 3 | 3 | 9 | Single ledger, reservations, safety buffer, frequent sync, reconciliation report | Pharmacist |
| R05 | Pharmacist review becomes bottleneck at peak | 3 | 3 | 9 | SLA dashboard, rule tuning (auto-approve low-risk OTC where legally ok ⚖️), staffing plan, messaging on expected times | Owner |
| R06 | PSP refuses or freezes pharmacy merchant account | 2 | 4 | 8 | Early onboarding with FAMHP proof; second PSP contract as backup | Owner |
| R07 | Scope creep (rebuilding LGO, too many Phase 1.5 features in Phase 1) | 4 | 3 | 12 | ADR-0008 boundary, MoSCoW, gates, steering | PO + tech lead |
| R08 | Next.js / dependency breaking changes or security advisories | 3 | 2 | 6 | Renovate, pinned versions, fast patch policy, E2E coverage | Tech lead |
| R09 | Low conversion due to trust gap with new brand | 3 | 3 | 9 | Trust architecture, real team photos, reviews on non-medicines, local SEO, click & collect for local patients | Owner + designer |
| R10 | Translation quality issues in medical content | 3 | 3 | 9 | Native pharmacist review; leaflets never machine-translated | Content lead |
| R11 | Key-person dependency (single senior dev) | 3 | 4 | 12 | Docs, ADRs, pair programming, IaC, at least 2 people per critical module | Tech lead |
| R12 | Phase 2 legally narrower than expected (e.g. no reservation via third-party identity) | 2 | 4 | 8 | Gate 2 before build; Phase 2 split into independent increments (care booking first) | PO |
| R13 | Cloud provider outage | 2 | 3 | 6 | HA, cross-region backups, documented restore, static fallback page via CDN | Tech lead |
| R14 | Accessibility non-compliance complaints (EAA) | 2 | 3 | 6 | WCAG 2.2 AA design system, axe in CI, annual audit | Designer |
| R15 | Medipim/SAM data quality or licensing constraints | 2 | 3 | 6 | Local overrides layer, content QA, contract review | Content lead |
