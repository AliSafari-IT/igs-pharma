# Security Architecture

Target: **OWASP ASVS 5.0 Level 2** for the whole platform at Phase 1; **Level 3** for health
modules (patients, prescriptions, messaging) at Phase 2. Threat model reviewed each phase.

## 1. Threat model (top threats, STRIDE-style)

| Threat | Example | Primary controls |
|---|---|---|
| Account takeover (customers) | Credential stuffing | Passkeys, breached-password check (HIBP k-anonymity), rate limits, bot protection, login alerts |
| Account takeover (staff) | Phishing a pharmacist | **Phishing-resistant MFA (passkeys)** mandatory, short sessions, device binding, optional IP allow-list for `platform` |
| Data exfiltration | SQLi, IDOR on orders | Parameterised queries (Drizzle), per-request authorization checks, RLS, UUIDv7 ids (non-enumerable), scoped queries |
| Order fraud | Stolen cards, resellers abusing OTC limits | PSP 3-D Secure, velocity rules, per-customer period limits (REQ-PHC-02), pharmacist review |
| Payment tampering | Forged webhook | Signature verification, re-fetch status from PSP, idempotency |
| Supply-chain compromise | Malicious npm package | Lockfile, Renovate with minimum release age, `pnpm` `onlyBuiltDependencies`, SBOM, provenance, image scanning |
| Insider misuse | Staff browsing a neighbour's orders | Least privilege, audit of health-data access, weekly access review, break-glass with reason |
| Ransomware / data loss | Compromised credentials to cloud | IaC, MFA on cloud, separate backup account with immutable (object-lock) copies, restore drills |
| XSS / content injection | CMS content | React escaping, strict **CSP with nonces**, sanitised rich text, Trusted Types (where feasible) |
| DoS / scraping | Bot traffic during promotions | CDN/WAF, rate limiting at edge and app, caching |

## 2. Identity & access

### Customers
- E-mail + password (Argon2id) **or** passkey; magic-link login optional; e-mail verification
  before first order with medicines.
- Optional TOTP; mandatory step-up (re-auth) for changing e-mail/password/addresses.
- Phase 2: **itsme®** identity proofing raises `identity_assurance` to unlock health features.

### Staff
- Separate staff realm (`kind = staff`), invitation-only, **passkeys mandatory** (TOTP as backup).
- Optional SSO (Microsoft Entra ID / Google Workspace) via OIDC if the pharmacy uses it.
- Session: 8 h absolute, 30 min idle on sensitive screens; re-auth for high-risk actions
  (refund > threshold, role changes, data export).

### Authorization
- **RBAC** (roles → permissions like `orders.read`, `orders.review.decide`, `patients.read_health`)
  scoped by `location_id`.
- **ABAC** conditions for sensitive data (e.g. only pharmacists can read questionnaire answers;
  only the assigned pharmacist can decide a claimed review).
- Enforcement in **one place**: module command/query handlers call `authorize(actor, action, resource)`.
  UI hides what you can't do, but never is the control.
- **Postgres RLS** on `pharmacy`, `privacy` and Phase 2 `care` schemas as defense in depth:
  app sets `SET LOCAL app.actor_id / app.role` per transaction.
- Separate DB roles: `app_web` (no access to staff-only schemas), `app_platform`, `app_worker`,
  `migrator`, `readonly_reporting` (no health schemas).

## 3. Data protection

| Data class | Examples | Controls |
|---|---|---|
| **C4 Health** | Questionnaire answers, Rx codes, care notes, messages | Field-level envelope encryption (AES-256-GCM, data keys wrapped by KMS), RLS, access audited, never in logs/analytics, retention-bound |
| **C3 Personal** | Name, address, e-mail, phone, order contents | Encrypted at rest (disk), RBAC, masked in back-office lists, no prod copies |
| **C2 Internal** | Prices, stock, supplier data | RBAC |
| **C1 Public** | Product content, articles | — |

- Keys: cloud **KMS / Secret Manager**; key rotation yearly; `key_id` stored with ciphertext.
- Secrets never in repo; `.env` only for local dev; runtime secrets injected by the platform.
- Backups encrypted; immutable copy in a second region/account.

## 4. Audit logging

- `audit.events` is **append-only** (INSERT-only grants), **hash-chained** (`hash = sha256(prev_hash || canonical_event)`),
  partitioned monthly; daily integrity job verifies the chain and anchors the daily head hash
  in a separate store (e.g. object-lock bucket).
- Logged: auth events, role changes, every read of C4 data, pharmacist decisions, price and
  promotion changes, refunds, exports, DSR actions, settings changes.
- Auditor view in `platform` for `owner`, `pharmacist_titular`, `dpo`.

## 5. Application security controls

- **Headers:** CSP (nonce-based, `strict-dynamic`), HSTS (preload), `X-Content-Type-Options`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `frame-ancestors 'none'`.
- **CSRF:** Server Actions' built-in origin checks + SameSite=Lax cookies; explicit tokens for route handlers.
- **Input validation:** Zod at every boundary (Server Actions, route handlers, job payloads, webhooks).
- **Rate limiting:** edge (WAF) + app-level (Postgres-backed token bucket or provider limiter) on
  login, sign-up, password reset, checkout, search.
- **File uploads (Phase 2):** type sniffing, size limits, malware scan (ClamAV), stored in private
  bucket, served via short-lived signed URLs.
- **Dependency hygiene:** Renovate weekly, auto-merge patch updates with green CI, security advisories immediate.
- **Next.js specifics:** keep up with security releases (patch within 48 h for critical);
  never rely on `proxy.ts` (middleware) alone for authorization; mark server-only modules with
  `import "server-only"`; avoid leaking server data via props to client components (`taint` APIs).

## 6. Infrastructure security

- Private networking between apps and DB; DB not publicly reachable.
- Least-privilege cloud IAM; MFA for all cloud console users; break-glass account sealed.
- CI uses OIDC federation to the cloud (no long-lived deploy keys) where supported.
- Container images: minimal base, non-root, read-only filesystem, scanned (Trivy) before deploy.

## 7. Assurance activities

| Activity | When |
|---|---|
| Threat modelling workshop | Phase 0, Phase 2 gate, major features |
| SAST / dependency / secret scanning | Every PR |
| DAST baseline (OWASP ZAP) | Nightly against staging |
| External penetration test | Before Phase 1 go-live, before Phase 2 go-live, then yearly |
| Access review | Monthly (staff roles), weekly (break-glass usage) |
| Restore drill | Quarterly |
| Phishing / security awareness training for staff | Yearly + onboarding |
| Responsible disclosure | `/.well-known/security.txt` + security@ mailbox |
