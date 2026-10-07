# 0008 — Integrate the certified LGO for dispensing; don't rebuild it

- Status: Proposed
- Date: 2026-10-07

## Context
In Belgium, dispensing software used by community pharmacies must meet official requirements
(homologation/certification) to access e-prescriptions, the shared pharmaceutical record,
tarification/third-party payer and safety-feature verification. Building and certifying this is a
multi-year effort and a separate business.

## Decision
- The **LGO remains the system of record** for dispensing, reimbursement, patient medication
  record and FMD verification.
- IGS-Pharma Platform owns: online channel, stock *view* & reservations, web orders, pharmacist
  review of web orders, patient online accounts, care-service booking, communication.
- Integration through a `PharmacySystemPort` adapter (API preferred, file exchange fallback).

## Consequences
- ✅ Legal compliance for Rx stays where it is certified; huge scope reduction.
- ⚠️ Dependency on LGO vendor capabilities → Phase 0 vendor discovery is critical.
- 🔁 Re-evaluate only if IGS-Pharma decides to become a software vendor (would need own ADR).
