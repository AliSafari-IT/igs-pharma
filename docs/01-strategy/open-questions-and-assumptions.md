# Open Questions & Assumptions

Answers to these change scope, cost or architecture. Track the answer + date + who decided.

## Open questions

| # | Question | Why it matters | Owner | Answer |
|---|---|---|---|---|
| Q1 | Does IGS-Pharma operate (or will it acquire) a **licensed pharmacy open to the public** in Belgium? Who is the **pharmacist-titular**? | Online sale of medicines is only allowed as an extension of a physical pharmacy. Without it, only non-medicine products can be sold. | Owner | **Yes.** IGS-Pharma operates a licensed pharmacy at Rue de Bosnie 104, 1060 Saint-Gilles (Brussels). *(2026-10-07, Ali Safari)* |
| Q2 | Which **pharmacy software (LGO)** is used today (e.g. Farmad, Officinall, Sabco, Nextpharm, Greenock…)? Does it have an API / partner programme? | Drives stock sync (Phase 1) and the whole Rx strategy (Phase 2). | Owner | **Officinall.** *(2026-10-07, Ali Safari)* |
| Q3 | Is there a **dispensing robot** (e.g. BD Rowa, Omnicell/Mach4) and how is stock managed? | Picking flow and stock source of truth. | Owner | **No** dispensing robot. *(2026-10-07, Ali Safari)* |
| Q4 | **Region / language** of the pharmacy (Flanders, Wallonia, Brussels, German-speaking community)? | Default language, legal language obligations, carrier choice. | Owner | **Brussels** (Saint-Gilles). All 4 languages: **NL, FR, DE, EN.** *(2026-10-07, Ali Safari)* |
| Q5 | Expected **catalogue size** online (e.g. 3k vs 25k SKUs) and launch volume (orders/day)? | Search engine choice, fulfilment staffing, infra sizing. | Owner | **~2 000 SKUs**, ~**100 orders/day.** *(2026-10-07, Ali Safari)* |
| Q6 | **Delivery model**: carrier only, own courier for local zone, pickup lockers? Cold-chain products? | Integrations, packaging, legal delivery conditions. | Owner | **All three:** pickup at pharmacy, own courier for local zone, and postal/pickup lockers. *(2026-10-07, Ali Safari)* |
| Q7 | **Pharmacist review hours** (e.g. Mon–Sat 8:30–18:30)? Weekend/holiday handling? | SLA promises shown at checkout. | Owner | **Mon–Fri 09:00–12:30 & 13:00–18:30; Sat 09:00–12:30; Sun closed.** *(2026-10-07, Ali Safari)* |
| Q8 | **Pricing policy**: same price online as in-store? Promotions on non-medicines only? | Medicine price/advertising rules; pricing engine scope. ⚖️ | Owner + counsel | **Yes** — same price online as in-store. **Yes** — promotions on non-medicines only. *(2026-10-07, Ali Safari)* |
| Q9 | **Team**: in-house developers, agency, or mixed? Who operates the platform in production? | Tech-stack familiarity, on-call model, budget. | Owner | **Mixed.** Platform operated by **Ali Safari.** *(2026-10-07, Ali Safari)* |
| Q10 | **Hosting preference / constraints** (EU-owned provider required? existing contracts?) | ADR-0005 final choice. | Owner + DPO | Accept **ADR-0005** as final: EU-sovereign hosting on **Scaleway**. *(2026-10-07, Ali Safari)* |
| Q11 | Existing **brand assets** (logo, name usage "IGS-Pharma", domain names: `.be`, NL/FR variants)? | Design, SEO, FAMHP listing (site URL must be registered). | Owner | **Confirmed** — brand assets available. *(2026-10-07, Ali Safari)* |
| Q12 | **B2B** customers (care homes, GPs) in scope? | Peppol e-invoicing, B2B pricing — Phase 1.5. | Owner | **Yes** — B2B in scope. Peppol e-invoicing and B2B pricing planned for **Phase 1.5.** *(2026-10-07, Ali Safari)* |
| Q13 | Any **existing customer data** (loyalty cards, newsletter lists) to migrate? | GDPR lawful basis for migration, consent re-collection. | Owner + DPO | **N/A** — no existing customer data to migrate. *(2026-10-07, Ali Safari)* |
| Q14 | Interest in **care services** (vaccination, medication review, reference pharmacist) online booking? | Phase 2 prioritisation. | Owner | **Yes** — in scope for **Phase 2** prioritisation. *(2026-10-07, Ali Safari)* |

## Working assumptions (until answered)

| # | Assumption |
|---|---|
| A1 | IGS-Pharma is (or is attached to) a single licensed Belgian community pharmacy; the pharmacist-titular is legally responsible for the webshop. |
| A2 | One pharmacy location at launch; architecture supports multiple locations later (multi-site stock). |
| A3 | Launch market: **Belgium only**; delivery addresses in Belgium. |
| A4 | ~~Catalogue at launch: 5–15k SKUs; volume 20–150 orders/day in year 1.~~ Replaced by Q5: ~2k SKUs, ~100 orders/day. |
| A5 | The LGO remains the system of record for dispensing, reimbursement and the shared pharmaceutical record. |
| A6 | Brussels pharmacy (Q4), so the default language is FR or NL from the browser locale. All 4 languages (NL/FR/DE/EN) are supported in the UI; product content is at least NL + FR at launch. |
| A9 | Cold-chain products are **not** shipped by locker or post at launch. They are available only through pharmacy pickup or the own local courier. *(Q6 did not cover cold chain.)* |
| A10 | Orders placed outside the review hours (Q7), and on Belgian public holidays, are reviewed on the next opening slot. Checkout shows the expected review time. |
| A11 | The pharmacist-titular is still to be named (Q1 confirmed the licence but not the person). |
| A7 | Team of 4–6 (see team doc); TypeScript is the main language. |
| A8 | All personal and health data is stored and processed in the EU. |
