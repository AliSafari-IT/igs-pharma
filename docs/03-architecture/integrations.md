# Integrations

All integrations are implemented as **adapters** behind a port interface in the owning module
(`packages/modules/<module>/adapters/<vendor>`), so vendors can be swapped and mocked in tests.
Inbound webhooks land in `payments.webhook_inbox` / generic `system.inbox` first (store → ack →
process asynchronously, idempotent by provider event id).

## Overview

| Integration | Phase | Direction | Mechanism | Owner module |
|---|---|---|---|---|
| PSP (Mollie / Adyen / Stripe) | 1 | ↔ | REST + webhooks | payments |
| Shipping (Sendcloud / bpost / PostNL / DHL) | 1 | ↔ | REST + webhooks | fulfilment |
| Medipim (product content) | 1 | ← | REST API, scheduled delta import | catalog |
| SAM (FAMHP authentic source) | 1 | ← | Periodic export download (XML) | catalog |
| LGO (certified pharmacy software) | 1 (stock) / 2 (Rx) | ↔ | Vendor API / file export / DB view — **TBD Phase 0** | inventory, rx |
| E-mail / SMS provider (EU) | 1 | → | API | notify |
| Peppol access point | 1.5 | → | API (e.g. via accounting tool or AP provider) | orders/invoices |
| Accounting (e.g. Exact Online, Odoo, Yuki, Octopus) | 1.5 | → | API / export | orders/invoices |
| Address validation (bpost) | 1 | → | API | customers |
| itsme® | 2 | ↔ | OpenID Connect | identity |
| eID (in-store verification) | 2 | — | Staff verifies eID in pharmacy, records verification | identity |
| Calendar / booking | 2 | ↔ | Own module; ICS export | care |
| Video consult (if allowed) | 2 | — | EU provider (e.g. Whereby EU / Jitsi self-hosted) | care |

## Payments

**Recommendation: Mollie** for a Belgian SMB (Bancontact, Bancontact QR, cards, Apple Pay,
Google Pay, Wero/Payconiq where available, SEPA transfer, Klarna optional; EU-regulated; simple
API; good BE/NL support). **Adyen** if volume grows or omnichannel POS integration is wanted
(unified in-store + online). **Stripe** is a valid alternative.

- **Pharmacy acceptance:** PSPs classify pharmacies as restricted — confirm onboarding of
  medicines explicitly (FAMHP registration proof usually requested).
- Use **hosted checkout / components** → minimal PCI DSS scope (SAQ A).
- Webhook signature verification; re-fetch payment status from the API before state transitions.
- Refund API used automatically when the pharmacist refuses an order.
- Authorisation-then-capture is **not** generally available for Bancontact → design for
  "paid then refund on refusal"; for cards, optionally authorise and capture after approval.

## Shipping

- **Sendcloud** (multi-carrier, labels, tracking page, returns portal) or direct carrier APIs.
- Carrier choice: bpost (home, pick-up points, parcel lockers), PostNL, DHL; own courier for a
  local zone if desired (same-day).
- Per-product shipping constraints: `cold_chain`, `hazardous` (e.g. aerosols, alcohol-based gels),
  `fragile`, weight/volume.
- Neutral sender name option on labels (discretion).

## Medipim

- Belgian product information database used by pharmacy webshops: names, descriptions,
  images, leaflets, CNK, categories, per language.
- Strategy: **delta import every night** + on-demand refresh; imported content lands in
  `product_content` with `source = medipim`; local overrides are kept in a separate layer so
  re-imports never overwrite pharmacist-approved edits.
- Licence: check rights to display images/texts online; attribution requirements.

## SAM (authentic source of medicines, FAMHP)

- Authoritative data for medicines: authorisation, legal delivery status (Rx / OTC),
  packages (CNK), leaflets/SmPC links, reimbursement data.
- Use it to **verify `legal_status`** of every medicine at import — a nightly job flags any
  product whose status changes to Rx (→ automatically unpublished, REQ-WEB-04).

## LGO (certified pharmacy software)

Phase 0 must determine what the vendor offers:

| Option | Phase 1 use | Phase 2 use |
|---|---|---|
| **A. Vendor API / partner programme** (preferred) | Real-time stock, sales push | Rx reservation status, prepared orders, patient lookups (with consent) |
| **B. Scheduled exports / imports (CSV/XML/SFTP)** | Stock every 5–15 min; sales import | Limited: status via manual steps |
| **C. Nothing available** | Web has own stock pool with manual transfers; daily reconciliation | Rx reservation handled as a task list; staff re-key in LGO |

The adapter interface:

```ts
interface PharmacySystemPort {
  fetchStockLevels(since?: Date): AsyncIterable<StockLevel>;
  recordWebSale(sale: WebSale): Promise<void>;          // decrement LGO stock
  // Phase 2
  submitRxReservation?(r: RxReservationRequest): Promise<LgoRef>;
  getRxReservationStatus?(ref: LgoRef): Promise<RxStatus>;
}
```

## itsme® (Phase 2)

- OIDC integration (Better Auth generic OIDC plugin); request minimal claims; assurance level
  "high" for health features.
- Store: `identity_verified_at`, method, a pseudonymous `sub`; national number only if a concrete
  legal need exists (then encrypted, access-logged).

## Integration non-goals

- Direct calls to eHealth services (e-prescription, GFD, MyCareNet) from our platform — through
  the certified LGO only ([ADR-0008](adr/0008-integrate-certified-lgo-for-dispensing.md)).
