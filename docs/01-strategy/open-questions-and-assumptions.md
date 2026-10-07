# Open Questions & Assumptions

Answers to these change scope, cost or architecture. Track the answer + date + who decided.

## Open questions

| # | Question | Why it matters | Owner | Answer |
|---|---|---|---|---|
| Q1 | Does IGS-Pharma operate (or will it acquire) a **licensed pharmacy open to the public** in Belgium? Who is the **pharmacist-titular**? | Online sale of medicines is only allowed as an extension of a physical pharmacy. Without it, only non-medicine products can be sold. | Owner | |
| Q2 | Which **pharmacy software (LGO)** is used today (e.g. Farmad, Officinall, Sabco, Nextpharm, Greenock…)? Does it have an API / partner programme? | Drives stock sync (Phase 1) and the whole Rx strategy (Phase 2). | Owner | |
| Q3 | Is there a **dispensing robot** (e.g. BD Rowa, Omnicell/Mach4) and how is stock managed? | Picking flow and stock source of truth. | Owner | |
| Q4 | **Region / language** of the pharmacy (Flanders, Wallonia, Brussels, German-speaking community)? | Default language, legal language obligations, carrier choice. | Owner | |
| Q5 | Expected **catalogue size** online (e.g. 3k vs 25k SKUs) and launch volume (orders/day)? | Search engine choice, fulfilment staffing, infra sizing. | Owner | |
| Q6 | **Delivery model**: carrier only, own courier for local zone, pickup lockers? Cold-chain products? | Integrations, packaging, legal delivery conditions. | Owner | |
| Q7 | **Pharmacist review hours** (e.g. Mon–Sat 8:30–18:30)? Weekend/holiday handling? | SLA promises shown at checkout. | Owner | |
| Q8 | **Pricing policy**: same price online as in-store? Promotions on non-medicines only? | Medicine price/advertising rules; pricing engine scope. ⚖️ | Owner + counsel | |
| Q9 | **Team**: in-house developers, agency, or mixed? Who operates the platform in production? | Tech-stack familiarity, on-call model, budget. | Owner | |
| Q10 | **Hosting preference / constraints** (EU-owned provider required? existing contracts?) | ADR-0005 final choice. | Owner + DPO | |
| Q11 | Existing **brand assets** (logo, name usage "IGS-Pharma", domain names: `.be`, NL/FR variants)? | Design, SEO, FAMHP listing (site URL must be registered). | Owner | |
| Q12 | **B2B** customers (care homes, GPs) in scope? | Peppol e-invoicing, B2B pricing — Phase 1.5. | Owner | |
| Q13 | Any **existing customer data** (loyalty cards, newsletter lists) to migrate? | GDPR lawful basis for migration, consent re-collection. | Owner + DPO | |
| Q14 | Interest in **care services** (vaccination, medication review, reference pharmacist) online booking? | Phase 2 prioritisation. | Owner | |

## Working assumptions (until answered)

| # | Assumption |
|---|---|
| A1 | IGS-Pharma is (or is attached to) a single licensed Belgian community pharmacy; the pharmacist-titular is legally responsible for the webshop. |
| A2 | One pharmacy location at launch; architecture supports multiple locations later (multi-site stock). |
| A3 | Launch market: **Belgium only**; delivery addresses in Belgium. |
| A4 | Catalogue at launch: 5–15k SKUs; volume 20–150 orders/day in year 1. |
| A5 | The LGO remains the system of record for dispensing, reimbursement and the shared pharmaceutical record. |
| A6 | Default language follows the pharmacy region; all 4 languages (NL/FR/DE/EN) supported in UI, product content at least NL + FR at launch. |
| A7 | Team of 4–6 (see team doc); TypeScript is the main language. |
| A8 | All personal and health data is stored and processed in the EU. |
