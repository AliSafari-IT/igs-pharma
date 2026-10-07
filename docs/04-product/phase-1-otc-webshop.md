# Phase 1 — OTC Webshop (Storefront)

## 1. Information architecture

```
/{locale}
├── /                       Home
├── /c/{category-slug}      Category listing (PLP) with facets
├── /p/{product-slug}-{cnk} Product detail (PDP)
├── /search?q=              Search results
├── /brands, /b/{brand}     Brands
├── /advice                 Health & wellness articles (pharmacist-approved)
├── /advice/{slug}
├── /pharmacy               About the pharmacy, team, hours, licence, map
├── /cart
├── /checkout               Multi-step (details → delivery → review & questions → payment)
├── /account                Orders, addresses, profile, privacy, (Phase 2: health space)
├── /help                   FAQ, delivery, returns, contact a pharmacist
└── /legal/*                T&Cs, privacy, cookies, accessibility, legal notice
```

Top-level categories (proposal): **Medicines & health** · **Skin & dermocosmetics** ·
**Mother & baby** · **Vitamins & supplements** · **Hygiene & care** · **Medical devices &
first aid** · **Sport & wellbeing** · **Natural & aromatherapy** · **Eyes, ears & mouth**.

## 2. Feature list (MoSCoW)

### Must (go-live)
- **Catalogue**: PLP with filters (brand, form, age group, price, availability), sort, pagination;
  PDP with gallery, price incl. VAT, availability ("in stock / ships today if ordered before 14:00"),
  usage, composition, warnings, leaflet link, related products (non-medicine cross-sell only ⚖️).
- **Search**: autocomplete (products, categories, brands, articles), typo-tolerant trigram, synonym
  table (brand ↔ active substance), CNK search.
- **Medicine safeguards**: notice block, quantity limit messaging, questionnaire at checkout,
  "a pharmacist reviews your order" explanation, contact-a-pharmacist entry points.
- **Cart**: persistent (guest + account merge), quantity limits enforced live, free-shipping
  threshold indicator (non-coercive, no medicine push ⚖️).
- **Checkout**: guest or account; Belgian address with validation; delivery options (home, pick-up
  point, locker, pickup in pharmacy); payment (Bancontact, cards, Apple/Google Pay, Wero/Payconiq);
  accept T&Cs (versioned); order summary with VAT breakdown.
- **Account**: sign-up/login (passkey or password), orders & tracking, re-order, invoices (PDF),
  addresses, communication preferences, privacy centre (export / delete request).
- **Notifications**: order received, under pharmacist review, info requested, approved/refused,
  shipped, ready for pickup, delivered, refund — e-mail (+ SMS for pickup).
- **Content**: home merchandising, articles, FAQ, pharmacy page, legal pages.
- **Compliance UI**: EU common logo, legal footer data, cookie consent, accessibility statement.
- **Languages**: NL / FR / DE / EN switcher; persistent preference.

### Should (≤ 3 months after launch)
- Click & collect with pickup slot; pickup lockers.
- Wishlist / favourites; "notify me when back in stock".
- Saved questionnaire answers (with consent) to speed up repeat orders.
- Live chat with pharmacy staff during opening hours.

### Could
- Subscriptions for non-medicines; loyalty for non-medicines; gift cards; reviews for
  non-medicines (moderated); product comparison; personalised recommendations (consent-based,
  no health profiling without explicit consent).

## 3. Order flow (customer perspective)

1. Add products → cart shows limits and pharmacist-review notice if medicines.
2. Checkout step "Your health questions" appears **only** if a product requires a questionnaire
   (short, plain-language, per product; answers can trigger "contact pharmacist" instead of refusal).
3. Pay → confirmation: "Thank you. Our pharmacist will check your order — usually within
   30 minutes during opening hours."
4. Pharmacist approves → "Your order is being prepared" → shipped/ready.
5. If info needed: e-mail/SMS with secure link to answer or call back; SLA timer paused.
6. If refused: clear, kind explanation + automatic refund + advice to consult a doctor/pharmacist.

## 4. Pharmacy rules engine (Phase 1 rule types)

| Rule | Example | Effect |
|---|---|---|
| `max_qty_per_order` | Paracetamol 1 g: max 2 packs | Cart blocks above limit |
| `max_qty_per_period` | Same substance: max N packs / 30 days / customer | Checkout blocks or routes to review |
| `substance_group_limit` | Total of a substance class across products (e.g. combined analgesics) | Cart message + review |
| `age_min` | 16+ / 18+ products | Age confirmation; review if doubt |
| `requires_questionnaire` | Emergency contraception, PPIs, antihistamines | Questionnaire version stored |
| `requires_review` | All medicines (default true) | Order to review queue |
| `block_online` | Product temporarily not sold online | Unpublished |
| `cold_chain_delivery_only` | Certain products | Restricts delivery options |

Rules are versioned, configured by pharmacists in `platform`, and every evaluation result is
stored with the order (for audit and explanation).

## 5. Non-functional requirements

| Area | Target |
|---|---|
| Performance | p75 mobile LCP < 2.5 s, INP < 200 ms, CLS < 0.1; JS budget per route ≤ 170 kB gz on PLP/PDP |
| Availability | 99.9 % monthly (storefront), graceful degradation if search or PSP is down |
| Scalability | 10× launch peak without manual intervention |
| SEO | SSR/SSG pages, structured data (`Product`, `Offer`, `BreadcrumbList`, `Organization`/`Pharmacy`), hreflang, sitemaps per locale, clean URLs |
| Accessibility | WCAG 2.2 AA |
| Privacy | No third-party trackers before consent; no health data in analytics |
| Browser support | Last 2 versions of evergreen browsers; iOS Safari 16+ |

## 6. Phase 1 acceptance (definition of done for go-live)

- All MUST features demoed in staging with production-like data.
- All Phase 1 MUST rows in the [compliance matrix](../02-compliance/compliance-requirements-matrix.md) green.
- Pharmacist team completed 2 weeks of "shadow operations" on staging.
- Runbooks for: payment outage, carrier outage, LGO sync failure, pharmacist unavailable.
