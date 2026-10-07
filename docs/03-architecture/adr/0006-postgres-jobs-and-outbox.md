# 0006 — Postgres-backed jobs and transactional outbox

- Status: Proposed
- Date: 2026-10-07

## Context
We need reliable async work (e-mails, imports, LGO sync, retention, webhooks processing) and
cross-module events, without adding Redis/Kafka to operate.

## Decision
- **pg-boss** (or Graphile Worker) for jobs, cron schedules, retries with backoff, dead-letter.
- **Transactional outbox**: modules write events to `system.outbox` in the same transaction as
  the business change; the worker relays them to subscribers (in-process handlers / jobs).
- All handlers idempotent.

## Consequences
- ✅ Exactly-once *effects* through idempotency; no dual-write bugs.
- ✅ One datastore to back up and monitor.
- ⚠️ Throughput ceiling far above our needs (thousands of jobs/min); revisit if exceeded.

## Alternatives considered
BullMQ + Redis; Temporal (great for long workflows — candidate for Phase 2 if Rx workflows grow
complex); cloud queues (vendor lock-in, not transactional with DB).
