# Observability, Incident Response & Business Continuity

## 1. Observability

| Signal | Implementation |
|---|---|
| Traces | OpenTelemetry SDK in `web`, `platform`, `worker` (Next.js instrumentation hook) → Tempo |
| Metrics | OTel metrics + Postgres exporter → Prometheus/Mimir; Grafana dashboards |
| Logs | Structured JSON (allow-listed fields, PII scrubbing) → Loki; 30–90 days |
| Errors | Sentry (EU region) or self-hosted GlitchTip; PII scrubbing, no request bodies |
| Real-user monitoring | Web Vitals sent first-party (consent-free, no PII) |
| Synthetic | Every 5 min: home, PDP, search, add-to-cart, checkout to PSP page (test mode on staging; prod up to payment page), FAMHP logo link target |

### Key dashboards
- **Business**: orders/hour, conversion, payment success rate per method, refund rate.
- **Pharmacy ops**: review queue length & SLA, time to approve, fulfilment backlog, pickups waiting.
- **Platform**: p95 latency per route, error rate, DB connections/CPU/locks/slow queries, job queue depth & failures, outbox lag.
- **Integrations**: PSP webhook latency, carrier API errors, LGO sync freshness, Medipim/SAM import status.
- **Security**: failed logins, MFA failures, rate-limit hits, WAF blocks, break-glass usage.

### Alerts (examples)
| Alert | Threshold | Route |
|---|---|---|
| Storefront 5xx rate | > 1 % for 5 min | On-call (phone) |
| Payment success rate drop | < 85 % over 15 min | On-call |
| Review queue SLA breach | > 3 orders overdue | Pharmacy team (Teams/Slack + SMS) |
| LGO sync stale | > 30 min | Pharmacist on duty + tech |
| Outbox lag | > 5 min | Tech |
| SAM status change to Rx for published product | any | Pharmacist (auto-unpublished) |
| Audit chain integrity failure | any | Tech lead + DPO (P1) |
| Backup job failed | any | Tech |

## 2. On-call & support model

- Business hours: tech team + pharmacy team.
- Out of hours: best-effort on-call rotation for P1 (storefront down, payments failing, security
  incident); define with the team/agency contract (SLA).
- Status page for customers; internal incident channel.

## 3. Incident severity

| Sev | Definition | Response |
|---|---|---|
| P1 | Data breach suspected; storefront or checkout down; wrong medicines shipped systematically | Immediate; incident lead; DPO informed if personal data involved |
| P2 | Major feature degraded (search, review queue, a payment method) | < 1 h in business hours |
| P3 | Minor bug, workaround exists | Next business day |

## 4. Personal data breach procedure (GDPR Art. 33/34)

1. **Detect & contain** (revoke credentials, block IPs, isolate component).
2. **Log** in the breach register (time of awareness = T0).
3. **Assess** with DPO within 24 h: data categories (health?), volume, likely consequences.
4. **Notify GBA/APD within 72 h of T0** unless unlikely to result in a risk.
5. **Inform data subjects** without undue delay if high risk (health data → likely).
6. Consider FAMHP / Order notification if pharmaceutical safety is affected ⚖️.
7. **Post-mortem** (blameless) within 5 business days; actions tracked.

Tabletop exercise: before go-live and yearly.

## 5. Backups & disaster recovery

| What | How | Retention | Test |
|---|---|---|---|
| PostgreSQL | Managed PITR + daily encrypted logical dump to immutable cross-region bucket | PITR 14–30 days; dumps 35 days + monthly 12 months | **Quarterly restore drill** (full restore into isolated project, run integrity checks, measure RTO) |
| Object storage (private) | Versioning + cross-region replication | 90 days versions | Quarterly sample restore |
| Infrastructure | OpenTofu state (remote, versioned) | — | Rebuild staging from scratch twice a year |
| Secrets/keys | KMS key backups per provider practices; documented recovery | — | Yearly |

## 6. Business continuity (pharmacy operations)

- If the platform is down, the **physical pharmacy continues** on the LGO; web orders already
  paid remain visible via a daily exported "orders in progress" PDF/CSV (generated automatically
  each morning) — a pragmatic fallback.
- Customer communication templates prepared (delay, cancellation, breach notification) in 4 languages.

## 7. Runbooks to write in Phase 1c

`runbooks/` — payment outage · carrier outage · LGO sync failure · DB failover/restore ·
suspicious login wave · webhook backlog · rollback a release · rotate a secret · erase a customer
(DSR) · FAMHP inspection evidence export.
