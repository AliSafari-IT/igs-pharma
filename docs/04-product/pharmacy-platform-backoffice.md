# Pharmacy Platform (Back-office)

`apps/platform` — used daily by pharmacists, assistants, fulfilment and management. Design
goal: **dense, fast, keyboard-friendly**, same design system as the shop but in "work mode"
(compact spacing, tables, command palette `⌘K`).

## 1. Modules & screens

| Area | Screens / features | Main roles |
|---|---|---|
| **Dashboard** | Today: orders to review (with SLA timers), to pick, to ship, pickups waiting, stock alerts, LGO sync status | all |
| **Pharmacist review queue** | Claim → see order, customer history (same substance last 90 days), questionnaire answers, rule results → approve / request info / adjust qty / refuse with reason templates (4 languages) | pharmacist |
| **Orders** | Search & filters, detail with timeline (`order_events`), refunds, re-send e-mails, notes, returns | customer_service, pharmacist |
| **Fulfilment** | Batch pick lists (by shelf / robot), scan-to-pack (barcode CNK/GTIN), label printing, handover manifest, pickup handover (with code) | fulfilment |
| **Catalogue** | Products (CNK search), Medipim import review, content per locale, publish/unpublish, media, categories, brands, attributes | content_editor, pharmacist (approve medicine content) |
| **Pricing & promotions** | Price lists per channel, scheduled price changes, promotions with medicine exclusion and approval | owner, marketing |
| **Inventory** | Stock levels per location, safety buffers, movements ledger, adjustments with reason, expiry tracking, LGO sync runs & errors, reconciliation report | pharmacist, assistant |
| **Dispensing rules** | Rules & questionnaires editor, versioning, test-on-cart simulator | pharmacist_titular |
| **Customers** | Profiles, orders, consents, DSR requests (export/erase), communication log | customer_service, dpo |
| **Content (Payload CMS)** | Pages, articles (pharmacist review workflow), banners, FAQ, legal docs (versioned) | content_editor, pharmacist |
| **Reports** | Sales by category/VAT rate, review SLA, fulfilment times, stock turnover, refused orders, top searches with no results | owner, accountant |
| **Settings** | Pharmacy data (legal identity, FAMHP no., hours, holidays), delivery methods & zones, PSP, notifications, feature flags | owner, admin_it |
| **Users & roles** | Invite staff, assign roles, enforce passkeys, session list & revoke, access review | owner, admin_it |
| **Audit** | Search audit events, integrity status, export for inspections | pharmacist_titular, dpo |

### Phase 2 additions
Patients (verified identity, consents), Rx reservations board (kanban: submitted → in review →
prepared → ready → collected), appointments calendar, secure messaging inbox, refill reminders,
care-service catalogue.

## 2. Review queue — detail

- **SLA**: due time computed with opening hours; colour states (on time / due soon / late).
- **Claiming** prevents two pharmacists working on the same order.
- **Context panel**: customer's previous orders containing the same active substance, age if
  known, flags from rules, questionnaire answers (decrypted on view → audited).
- **Decision templates**: short, multilingual, editable; refusal always includes advice text.
- **Four-eyes option** for configurable cases (e.g. high quantities).
- **Metrics**: median time-to-decision, refusal rate by reason, info-request rate.

## 3. Operational UX principles

- Every list: saved filters, CSV export (permission-gated, audited), keyboard navigation.
- Barcode scanner support (HID) everywhere a product can be selected.
- Optimistic UI with server confirmation; clear conflict messages (optimistic locking).
- Printing: A4 invoices, pick lists, and 4×6" shipping labels (Zebra-compatible ZPL/PDF).
- Works on a tablet at the packing station.
