# 0009 — CNK as product identity; Medipim + SAM as catalogue sources

- Status: Proposed
- Date: 2026-10-07

## Context
Belgian pharmacy products are identified by the **CNK** code (used by wholesalers, LGOs,
reimbursement). GTIN/EAN exists for most but not all items. Medicines' legal status must come
from an authoritative source.

## Decision
- `products.cnk` is the **business key** (unique); internal `id` is UUIDv7; GTINs stored as list.
- **Medipim** provides commercial content (texts, images, categories) in NL/FR/(DE/EN).
- **SAM** (FAMHP) is the authority for medicine legal status and leaflets; nightly verification.
- Local pharmacist overrides are stored in a separate layer and never overwritten by imports.

## Consequences
- ✅ Matching with LGO stock and wholesaler data is trivial.
- ⚠️ Non-pharmacy items without CNK get an internal code prefix (e.g. `IGS-…`).
