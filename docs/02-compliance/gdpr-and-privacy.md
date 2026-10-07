# GDPR & Privacy by Design

## 1. Why we treat the shop as health-data processing

A pharmacy order history can reveal pregnancy, sexual health, addiction (nicotine), digestive
or skin conditions, etc. Under GDPR this is **data concerning health (Art. 9)**. Therefore:

- a **DPIA** (Art. 35) is required before launch — large-scale or systematic processing of
  special-category data is very likely;
- a **DPO** should be designated (core activity involves special-category data) ⚖️ — can be external;
- access to order contents and questionnaires is **need-to-know** and **logged**.

## 2. Roles

| Party | Role |
|---|---|
| Pharmacy entity (pharmacist-titular / company) | **Controller** |
| Cloud provider, PSP (for payment data processing), e-mail/SMS provider, carrier, Medipim, monitoring | **Processors** → DPA (Art. 28) required |
| PSP for its own AML/fraud obligations, carriers in some setups | Possibly **independent controllers** — document |
| LGO vendor (Phase 2 integrations) | Processor of the pharmacy |

## 3. Lawful bases (proposal — validate with DPO ⚖️)

| Processing | Art. 6 basis | Art. 9 condition (if health data) |
|---|---|---|
| Account & order processing | Contract (6.1.b) | 9.2.h — provision of health care by a professional under secrecy (pharmacist); fallback explicit consent 9.2.a ⚖️ |
| Pharmacist review & questionnaires | Legal obligation (pharmaceutical care) 6.1.c / contract | 9.2.h |
| Invoicing & accounting retention | Legal obligation 6.1.c | — (minimise: invoice lines may show product names → protect) |
| Marketing e-mails | Consent (6.1.a) | **No health-based profiling** without explicit consent; default: none |
| Analytics | Consent (cookies) | No health data in analytics events (no product names of medicines in URLs/events sent to third parties) |
| Rx reservation & care services (Phase 2) | Contract / legal obligation | 9.2.h + eHealth consent where required |

## 4. Privacy by design — concrete engineering rules

1. **Data minimisation**: collect birth date only when needed (age gates / Phase 2); no national
   number in Phase 1.
2. **Separation**: identity data (`customers`) is separate from health-related data
   (`care.questionnaire_answers`, Phase 2 `care.*`) — different schema, different DB role,
   field-level encryption.
3. **No health data leaves the platform to marketing/analytics tools.** Analytics is first-party
   (e.g. self-hosted Plausible/Matomo/Umami in EU) with category-level events only.
4. **URLs and logs**: no personal data or medicine names in query strings; structured logs
   scrub PII by default (allow-list logging).
5. **Pseudonymised IDs** in logs/traces (`customer_id`, never e-mail).
6. **Discreet packaging & e-mail subjects**: e-mail subject lines never mention products
   (`Your order #1234 has shipped`), parcel labels show a neutral sender name option.
7. **Staff access**: role-based; "break-glass" access to sensitive data needs a reason and is
   reviewed weekly.
8. **Non-production**: staging uses synthetic/anonymised data only; production dumps are prohibited.
9. **Encryption**: TLS 1.2+ everywhere (1.3 preferred); disk encryption; field-level envelope
   encryption for health fields; backups encrypted.

## 5. Retention schedule (proposal ⚖️)

| Data | Retention | Basis |
|---|---|---|
| Orders & invoices | 7 years (Belgian accounting / tax: verify 7 vs 10 years for some records) | Legal obligation |
| Pharmacist review decisions & questionnaire answers | 10 years ⚖️ (align with pharmacy record-keeping rules) | Legal obligation / professional liability |
| Customer account (inactive) | Deleted/anonymised after 3 years of inactivity, after notice | Minimisation |
| Marketing consent records | Duration of consent + 5 years proof | Accountability |
| Audit logs | 10 years for health-data access; 2 years for technical logs | Accountability / security |
| Application logs | 30–90 days | Security |
| Cart / abandoned checkout | 30 days | Minimisation |
| Messaging with pharmacist (Phase 2) | ⚖️ to define with counsel | — |

Retention is enforced by scheduled jobs and covered by tests (REQ-PRV-04).

## 6. Data subject rights tooling (in `platform`)

- Search by customer → export (JSON + human-readable PDF) within 30 days.
- Erasure → anonymise identity data while keeping legally required records (invoices,
  pharmacist decisions) under legal hold; record the reason.
- Rectification, restriction, objection to marketing — self-service in the account where possible.

## 7. Cookies & tracking

- Strictly necessary only by default (session, cart, CSRF, language, consent record).
- Consent manager: first-party, accessible, equal "Accept" / "Refuse" buttons, granular categories.
- No Google Fonts from Google CDN (self-host with `next/font`), no third-party embeds without consent.

## 8. Breach response

See [observability & incident response](../07-operations/observability-and-incident-response.md):
detection → triage → DPO informed within 24 h → GBA/APD notification within 72 h if risk →
data subjects informed if high risk → post-mortem.

## 9. Documents to produce (owner: DPO + tech lead)

- [ ] Record of processing activities (RoPA)
- [ ] DPIA Phase 1 (and v2 for Phase 2)
- [ ] Privacy notice (NL/FR/DE/EN), cookie policy
- [ ] Processor register + signed DPAs, incl. transfer assessment (no US transfers of health data)
- [ ] Data breach register & procedure
- [ ] Staff confidentiality agreements & privacy training records
