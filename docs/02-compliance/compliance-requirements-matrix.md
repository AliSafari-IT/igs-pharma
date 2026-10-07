# Compliance Requirements Matrix

Every legal / healthcare requirement becomes a **testable requirement** with an ID, an owner
feature, and a verification method. The CI suite references these IDs in test names
(e.g. `it("REQ-WEB-03: common logo links to FAMHP listing")`) so we can produce an evidence
report per release.

**Priority:** `MUST` = blocks go-live · `SHOULD` = required within 3 months · `COULD` = nice to have.
**Phase:** 1 = OTC go-live · 2 = Rx & care.

## Website identity & medicine sale (WEB)

| ID | Requirement | Phase | Prio | Implementation | Verification |
|---|---|---|---|---|---|
| REQ-WEB-01 | Site displays pharmacy name, address, pharmacist-titular, FAMHP authorisation no., contact, company & VAT no. | 1 | MUST | Footer + Legal notice page, values from `pharmacy_settings` | E2E test + legal review |
| REQ-WEB-02 | EU common logo shown on every page offering medicines | 1 | MUST | `<CommonLogo/>` in layout for medicine routes | E2E test |
| REQ-WEB-03 | Common logo links to the pharmacy's entry on the FAMHP list | 1 | MUST | Config value, monitored by synthetic check | Synthetic monitor + E2E |
| REQ-WEB-04 | Only non-prescription medicines can be put in the cart | 1 | MUST | `legal_status` on product; cart guard + DB constraint | Unit + integration test |
| REQ-WEB-05 | Medicines ship only from the registered pharmacy stock | 1 | MUST | Fulfilment location = licensed pharmacy; no drop-ship for medicines | Integration test + process |
| REQ-WEB-06 | Delivery limited to Belgium (Phase 1) | 1 | MUST | Address validation, country allow-list | Unit test |
| REQ-WEB-07 | Customer can contact a pharmacist (phone/e-mail/chat during hours) | 1 | MUST | Contact widget on PDP + checkout + account | E2E test |
| REQ-WEB-08 | Package leaflet (per language) one click from every medicine PDP | 1 | MUST | Leaflet document link (SAM / Medipim) | E2E + content QA |
| REQ-WEB-09 | Mandatory medicine notice on medicine PDPs & cart | 1 | MUST | i18n string, legally approved wording ⚖️ | Snapshot test |

## Pharmaceutical care (PHC)

| ID | Requirement | Phase | Prio | Implementation | Verification |
|---|---|---|---|---|---|
| REQ-PHC-01 | Every order containing a medicine is validated by a pharmacist before fulfilment | 1 | MUST | Order state `awaiting_pharmacist_review`; fulfilment blocked by state machine | State machine tests |
| REQ-PHC-02 | Configurable max quantity per product / per active substance / per period per customer | 1 | MUST | Rules engine (`dispensing_rules`) | Unit tests per rule type |
| REQ-PHC-03 | Product-specific questionnaires (e.g. pregnancy, age, other medicines) | 1 | MUST | Questionnaire builder; answers stored encrypted with the order | Integration test |
| REQ-PHC-04 | Pharmacist can approve, request info, modify quantities, or refuse (with automatic refund) | 1 | MUST | Review queue in `platform` | E2E test |
| REQ-PHC-05 | Every pharmacist decision is attributable (who, when, why) | 1 | MUST | Audit event `pharmacy.review.decided` | Audit test |
| REQ-PHC-06 | Age-restricted products enforce age confirmation | 1 | SHOULD | Product flag + checkout step | Unit test |
| REQ-PHC-07 | Customer is informed of review SLA (hours) at checkout | 1 | SHOULD | Opening-hours service | E2E |

## Advertising & promotion (ADV)

| ID | Requirement | Phase | Prio | Implementation | Verification |
|---|---|---|---|---|---|
| REQ-ADV-01 | Promotions/loyalty exclude medicines by default; inclusion requires explicit, logged override | 1 | MUST | Promotion eligibility by category; override audited | Unit tests |
| REQ-ADV-02 | No customer reviews and no "bestseller" badges on medicines | 1 | MUST ⚖️ | Feature flags by `product_type` | E2E |
| REQ-ADV-03 | Health content published only after pharmacist approval | 1 | MUST | CMS workflow `draft → pharmacist_review → published` | CMS test |
| REQ-ADV-04 | Price reduction displays reference = lowest price of last 30 days | 1 | MUST | `price_history` table, computed reference price | Unit test |

## Consumer law (CON)

| ID | Requirement | Phase | Prio | Implementation | Verification |
|---|---|---|---|---|---|
| REQ-CON-01 | Total price incl. VAT and delivery before payment | 1 | MUST | Checkout summary | E2E |
| REQ-CON-02 | Order confirmation on durable medium (e-mail + PDF) with T&Cs | 1 | MUST | Transactional e-mail | Integration test |
| REQ-CON-03 | Withdrawal rights & exceptions clearly explained; returns flow | 1 | MUST | Returns module; T&Cs | Legal review |
| REQ-CON-04 | Invoices with correct VAT per line (6 % / 21 %) | 1 | MUST | Tax module; product VAT class | Unit + accountant check |
| REQ-CON-05 | B2B e-invoicing via Peppol | 1.5 | MUST (if B2B) | Peppol access point integration | Integration test |

## Accessibility (ACC)

| ID | Requirement | Phase | Prio | Implementation | Verification |
|---|---|---|---|---|---|
| REQ-ACC-01 | WCAG 2.2 AA on storefront and checkout | 1 | MUST | Design system + axe in CI | axe CI + manual audit |
| REQ-ACC-02 | Accessibility statement published | 1 | MUST | CMS page | Review |
| REQ-ACC-03 | Back-office usable by keyboard; AA contrast | 1 | SHOULD | Same design system | axe CI |

## Privacy & security (PRV / SEC)

| ID | Requirement | Phase | Prio | Implementation | Verification |
|---|---|---|---|---|---|
| REQ-PRV-01 | Cookie consent before non-essential cookies; refusing as easy as accepting | 1 | MUST | First-party consent manager | E2E (no tracker before consent) |
| REQ-PRV-02 | Data subject rights: access/export, rectification, erasure (with legal-hold exceptions) | 1 | MUST | DSR tooling in `platform` | Integration test |
| REQ-PRV-03 | Health-related data (questionnaires, Rx) encrypted at field level | 1 | MUST | Envelope encryption via KMS | Unit test + review |
| REQ-PRV-04 | Retention policies enforced automatically | 1 | MUST | Scheduled retention jobs | Job tests |
| REQ-PRV-05 | All personal data stored/processed in the EU; DPAs signed | 1 | MUST | Hosting choice ADR-0005 | Vendor register |
| REQ-SEC-01 | Staff MFA (passkey or TOTP) mandatory | 1 | MUST | Better Auth policy | Integration test |
| REQ-SEC-02 | RBAC with least privilege; access to health data logged | 1 | MUST | Permission checks + audit | Tests + audit report |
| REQ-SEC-03 | Append-only, tamper-evident audit log | 1 | MUST | Hash-chained `audit.events` | Integrity check job |
| REQ-SEC-04 | Backups: PITR, encrypted, off-site copy, quarterly restore drill | 1 | MUST | Managed PG + replication to second region | Drill report |
| REQ-SEC-05 | Pen-test before each phase go-live | 1 | MUST | External vendor | Report |
| REQ-SEC-06 | Breach procedure: DPA notification ≤ 72 h | 1 | MUST | Incident runbook | Tabletop exercise |

## Phase 2 — Prescriptions & care (RX / CARE)

| ID | Requirement | Phase | Prio | Implementation | Verification |
|---|---|---|---|---|---|
| REQ-RX-01 | Prescription-only medicines are never shipped unless a legally confirmed exception workflow applies | 2 | MUST | Fulfilment guard by `legal_status = RX` | State machine tests |
| REQ-RX-02 | Rx reservation requires verified identity (itsme® / eID) | 2 | MUST | Identity assurance level on account | Integration test |
| REQ-RX-03 | Prescription retrieval, validation, dispensing & tarification happen in the certified LGO | 2 | MUST | Integration boundary (ADR-0008) | Architecture review |
| REQ-RX-04 | Uploaded prescription images (if any) are never treated as a valid prescription; for information only | 2 | MUST ⚖️ | UI copy + process | Review |
| REQ-CARE-01 | Consent captured per care service; revocable | 2 | MUST | Consent store | Tests |
| REQ-CARE-02 | Secure messaging: encrypted, access-logged, retention-bound | 2 | MUST | Messaging module | Tests + pen-test |
| REQ-CARE-03 | Health modules meet OWASP ASVS Level 3 | 2 | SHOULD | Security uplift | Pen-test |
