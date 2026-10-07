# Regulatory Framework — Belgium & EU

> **Not legal advice.** This is the engineering team's map of the rules that shape the product.
> Every item marked ⚖️ must be confirmed by Belgian healthcare counsel and, where relevant, the
> FAMHP and the Order of Pharmacists. Laws change — re-check at every phase gate.

## 1. Authorities & bodies

| Body | Role for IGS-Pharma |
|---|---|
| **FAMHP** — Federal Agency for Medicines and Health Products (FAGG / AFMPS) | Supervises pharmacies & medicines; keeps the **public list of pharmacies authorised to sell non-prescription medicines online**; issues the link for the EU common logo; inspections. |
| **Order of Pharmacists** (Orde der Apothekers / Ordre des Pharmaciens) | Professional ethics (deontological code), must be informed of the online activity. ⚖️ |
| **RIZIV / INAMI** | Health insurance: reimbursement, tarification, pharmaceutical care fees (reference pharmacist, etc.) — Phase 2. |
| **eHealth platform** | Secure services for e-prescription, consent, therapeutic relationships, shared pharmaceutical record access — through certified software. |
| **FPS Public Health** | Food supplements notification (NUT numbers), cosmetics, general health products. |
| **FPS Economy** | Consumer law (Code of Economic Law), e-commerce, pricing, accessibility enforcement. |
| **Data Protection Authority** (GBA / APD) | GDPR supervisory authority; breach notifications within 72 h. |
| **CCB / Safeonweb** | Belgian Centre for Cybersecurity — NIS2 national authority. |
| **APB** (Belgian pharmacists' association) | Not a regulator, but publishes guidance, product data services and pharmacy tooling; useful partner. |

## 2. Online sale of medicines

### 2.1 EU level
- **Directive 2001/83/EC, Art. 85c** (introduced by the Falsified Medicines Directive
  **2011/62/EU**): Member States may allow distance selling of medicines to the public; the
  website must display specific information and the **EU common logo**.
- **Implementing Regulation (EU) No 699/2014**: design and technical requirements of the
  **common logo**; clicking it must lead to the pharmacy's entry on the national authority's list.
- **Delegated Regulation (EU) 2016/161** (safety features / unique identifier): verification and
  decommissioning via the national system (**BeMVO** in Belgium) — mostly relevant to Rx packs
  dispensed in Phase 2 (handled in the LGO).

### 2.2 Belgian level (key rules, simplified) ⚖️
- Online sale is permitted **only for non-prescription medicines** (and non-medicinal health
  products) and **only by a pharmacist-titular of a pharmacy open to the public**. The website
  is an **extension of that physical pharmacy**: medicines ship from its stock under its
  responsibility. (Royal Decree of 21 January 2009 on instructions for pharmacists, as amended.)
- **Prescription-only medicines may not be sold at a distance.**
- **Prior notification** of the website to the FAMHP (and information to the Order) before
  starting; the pharmacy then appears on the FAMHP list. Changes (URL, titular) must be notified.
- **Mandatory information on the site**, at minimum: pharmacy name & address, pharmacist-titular
  name, contact details, FAMHP pharmacy authorisation number, competent authority details, link to
  the FAMHP list via the **common logo** on every page offering medicines.
- **Pharmaceutical care obligations apply online too**: the pharmacist must be able to assess the
  request, give advice, limit quantities and refuse delivery when appropriate; the patient must
  be able to contact a pharmacist.
- **Delivery**: from the pharmacy, in packaging that guarantees quality and integrity of the
  product, with traceability; conditions for temperature-sensitive products.
- **No "online-only" pharmacies** and no sale of medicines through marketplaces/third-party
  platforms acting as seller.

### 2.3 Product categories and their regimes

| Category | Main framework | Product-level data we must hold |
|---|---|---|
| OTC medicines (human) | Medicines Act 25 March 1964; Directive 2001/83/EC | CNK, authorisation number, SmPC/leaflet (per language), legal status (OTC), active substance(s), warnings, max quantity policy |
| Medical devices | Regulation (EU) 2017/745 (MDR), 2017/746 (IVDR for self-tests) | CNK/GTIN, class, CE mark, UDI (where applicable), instructions for use |
| Food supplements | Directive 2002/46/EC; Belgian Royal Decree on nutrients; FPS notification | NUT/notification number, ingredients, allergens, warnings, (no medicinal claims) |
| Cosmetics | Regulation (EC) 1223/2009 | INCI list, warnings, responsible person |
| Biocides (e.g. anti-lice, insect repellents) | Regulation (EU) 528/2012 + Belgian authorisation | Authorisation number, mandatory label phrases |
| Rx medicines (Phase 2) | As above + reimbursement rules | Handled via LGO; reservation only |

## 3. Advertising & promotion of medicines ⚖️

- **Royal Decree of 7 April 1995** on information and advertising for medicines for human use
  (and Art. 9–10 of the Medicines Act):
  - advertising of **prescription medicines to the public is prohibited**;
  - advertising of OTC medicines to the public is allowed under strict content conditions
    (mandatory statements, no misleading claims, no inducement to excessive use);
  - prohibition on **offering premiums, benefits or rewards** linked to medicines in many forms.
- **Engineering consequences**:
  - Promotions, loyalty points, bundles, "free gift" and "buy 2 get 1" rules must be
    **configurable per product category** with medicines excluded by default.
  - Medicine product pages are **information**, not advertising: neutral tone, leaflet link,
    mandatory notices (e.g. *"This is a medicine. Read the package leaflet carefully. Ask your
    pharmacist for advice."* in each language — exact wording ⚖️).
  - **No customer reviews on medicines** by default; no "bestseller" rankings for medicines. ⚖️
  - Marketing e-mails must not push medicines in prohibited ways; segment by category.
  - SEO / paid ads on medicines: respect advertising rules and Google's pharmacy-ad certification
    (LegitScript or national-list based).

## 4. Consumer & e-commerce law

| Topic | Source | Product requirement |
|---|---|---|
| Pre-contractual info, order confirmation | Code of Economic Law (CEL) Book VI & XII; Directive 2011/83/EU | Clear total price incl. VAT and delivery; durable-medium confirmation e-mail |
| Right of withdrawal (14 days) | CEL Book VI | Exceptions for **sealed goods not suitable for return for health/hygiene reasons once unsealed**; for medicines the pharmacy should refuse re-sale for safety — clearly explained in T&Cs ⚖️ |
| Price indications | CEL Book VI; Omnibus Directive | Price reductions must reference the lowest price of the previous 30 days |
| Online dispute resolution | Reg. (EU) 524/2013 (ODR platform discontinued July 2025) ⚖️ verify current link obligations | Legal page content |
| Language of information | Belgian language legislation, labelling rules | Product info in the language(s) of the region of sale |
| Accessibility | **European Accessibility Act** (Directive 2019/882), applicable since **28 June 2025**, Belgian transposition | WCAG 2.2 AA (EN 301 549); accessibility statement (micro-enterprises are exempt for services — but we build to it anyway) |
| E-invoicing | Belgian **B2B Peppol e-invoicing mandatory since 1 Jan 2026** | B2B invoices via Peppol (Phase 1.5 B2B) |
| VAT | Belgian VAT Code | Medicines typically **6 %**, many other products **21 %**, some foods/supplements 6 % — VAT rate stored **per product**, validated by accountant |

## 5. Data protection & security

- **GDPR** (Reg. 2016/679) + Belgian Act of 30 July 2018. Purchases at a pharmacy can reveal
  health data → **Art. 9 special category**. Requires a valid Art. 9(2) condition, DPIA, DPO,
  strict access control. Details: [GDPR & privacy](gdpr-and-privacy.md).
- **ePrivacy / cookies**: prior consent for non-essential cookies; Belgian DPA guidance (refusal
  as easy as acceptance, no pre-ticked boxes).
- **NIS2** (Directive 2022/2555; Belgian law of 26 April 2024): healthcare providers are in scope
  *above size thresholds* (≥ 50 staff or > €10 M turnover). A single pharmacy is likely **out of
  scope** ⚖️, but we adopt NIS2-style measures (risk management, incident handling, supply chain)
  as our baseline — and we may be in scope as supplier to larger clients later.
- **EU AI Act** (Reg. 2024/1689): if we add AI features (search, chatbot), provide transparency
  ("you are talking to an AI"), keep humans (pharmacists) in the loop, never auto-decide on
  medical matters. Avoid anything that could be classified high-risk.
- **European Health Data Space** (Reg. 2025/327): entered into force 2025, applies gradually from
  2027+; patient access and interoperability expectations for EHR systems — keep FHIR-friendly
  data exports in mind for Phase 2.

## 6. Phase 2 specific (prescriptions & care) ⚖️

- **e-Prescription** (mandatory in Belgium since 2020): prescriptions identified by a **RID**
  barcode; accessed by pharmacies via certified software and eHealth services. Our platform
  does **not** call these services directly unless/until it is certified — the LGO does.
- **Shared pharmaceutical record** (GFD / DPP) and **therapeutic relationship / consent**: via
  certified software only.
- **Reimbursement & third-party payer** (tarification offices, MyCareNet): via the LGO.
- **Reference pharmacist** (*huisapotheker / pharmacien de référence*), medication schedule,
  **new-medicine guidance**, **vaccination in pharmacies** — care services we can *book and
  coordinate* online; clinical recording stays in the LGO.
- **Rx home delivery**: currently restricted; any exception (e.g. patients unable to travel) must be
  confirmed by counsel and implemented as an explicit, auditable workflow.
- **Telepharmacy / video consultations**: check the deontological code and data rules.

## 7. Launch checklist (regulatory)

- [ ] Legal opinion covering sections 2–5 received and reflected in the requirements matrix.
- [ ] FAMHP notification filed; listing visible; common logo links to our entry.
- [ ] Order of Pharmacists informed (provincial council). ⚖️
- [ ] Legal pages in NL/FR/DE/EN: T&Cs, privacy notice, cookie policy, accessibility statement,
      legal notice (pharmacy, titular, authorisation number, VAT, company number).
- [ ] DPO designated and published; DPIA signed; RoPA up to date.
- [ ] Data processing agreements (DPAs) with all processors (cloud, PSP, e-mail, carrier, Medipim).
- [ ] Medicine advertising rules reflected in promotions engine and CMS workflow.
- [ ] VAT mapping validated by accountant.
- [ ] Insurance (professional liability + cyber) reviewed for online activity.
