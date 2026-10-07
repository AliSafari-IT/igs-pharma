# 0005 — EU-sovereign hosting for all personal and health data

- Status: Accepted — Scaleway is the chosen provider (Q10 answered 2026-10-07, Ali Safari)
- Date: 2026-10-07

## Context
Health-related personal data; GDPR transfer rules; extra-territorial access risk (e.g. US CLOUD Act)
is a common concern of Belgian healthcare counsel and DPOs.

## Decision
Host apps, database, object storage, backups, logs and e-mail processing with **EU-headquartered
providers in EU regions**. Recommended: **Scaleway** (Paris/Amsterdam; managed PostgreSQL,
Serverless Containers or Kapsule, Object Storage, Secret Manager/KMS, Cockpit) or **OVHcloud**
(HDS-certified offers, Gravelines/Strasbourg). CDN/WAF: EU provider (e.g. Bunny.net) or a major
CDN with EU-only processing configured — decision documented with DPO.

## Consequences
- ✅ Simpler GDPR story, fewer transfer assessments.
- ⚠️ Fewer "one-click" DX features than Vercel; we own the container pipeline (manageable).
- ⚠️ Preview environments per PR built ourselves (container per branch) — or Vercel previews with
  synthetic data only, no production secrets.

## Alternatives considered
- **Vercel + Neon/Supabase (EU regions)** — superb DX; US-headquartered; acceptable for a pure
  catalogue, less so for health data. Could host *only* the public storefront later if needed.
- **AWS/Azure/GCP EU regions** — mature; same jurisdiction concern; higher complexity.
