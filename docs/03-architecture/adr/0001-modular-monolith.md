# 0001 — Modular monolith over microservices

- Status: Proposed
- Date: 2026-10-07

## Context
A single pharmacy, a small team (4–6), strict compliance needs, moderate traffic
(tens to low thousands of orders/day). Phase 2 adds modules but not radically different load.

## Decision
Build a **modular monolith**: domain modules in `packages/modules/*` with explicit public APIs,
one Postgres schema per module, events via a transactional outbox. Deploy as a few stateless
containers (`web`, `platform`, `worker`) that share the module code.

## Consequences
- ✅ Simple ops, single transaction boundary for orders + stock + audit, fast refactoring.
- ✅ Clean seams: any module can be extracted later behind its existing API and events.
- ⚠️ Requires discipline: boundaries enforced by lint rules and code review.
- ⚠️ One DB cluster is a shared failure domain → HA + PITR mandatory.

## Alternatives considered
- **Microservices** — distributed transactions for order/stock/payment, much higher ops and
  security surface; no scaling need justifies it.
- **Single Next.js app with logic in routes** — fast to start, becomes unmaintainable and makes
  Phase 2 risky.
