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

- **Headers (T-011, D-031):** one policy for both apps in `@igs/security-headers`
  (`packages/security-headers`), applied per request by `apps/web/src/proxy.ts` (composed with the
  next-intl locale routing) and `apps/platform/src/proxy.ts`. Each request gets a fresh 128-bit
  base64 nonce; the proxy passes it to Next on the request's `Content-Security-Policy` header (Next
  stamps it on its own `<script>`/`<style>` tags) and as `x-nonce` for server components.
  - **CSP** (production):

    ```
    default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'nonce-<n>';
    img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none';
    base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
    ```

    No `'unsafe-inline'` anywhere: Tailwind v4 and `next/font` ship stylesheet files, and Next nonces
    its inline scripts/styles. Inline `style="…"` attributes are therefore blocked — use classes.
  - **Dev exceptions** (`next dev` only): `script-src` adds `'unsafe-eval'` (React dev build / HMR),
    `connect-src` adds `ws: wss:` (HMR websocket); no `upgrade-insecure-requests`, no HSTS. Next's
    dev-tools overlay injects un-nonced `<style>` tags, so it renders unstyled in dev (known, dev only).
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (production only;
    **submitting** the domain to the HSTS preload list is a deliberate B-08 step once the final
    domains and subdomains are known — it is hard to undo),
    `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
    `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()`
    (a PSP payment iframe will be allowed explicitly when payments land),
    `Cross-Origin-Opener-Policy: same-origin`, `X-Frame-Options: DENY` (legacy, alongside
    `frame-ancestors 'none'`).
  - **platform only:** `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`.
  - The proxy matcher skips `_next/static`, `_next/image`, files with an extension and (web) `/api`
    and `/api/*`; those only get `X-Content-Type-Options: nosniff` from `next.config.ts` (JSON needs
    no CSP). Web also sends `X-DNS-Prefetch-Control: off` (prefetching leaks visited links to
    resolvers).
  - **Trade-off: every CSP-protected page renders dynamically** (root layouts set
    `dynamic = "force-dynamic"`): prerendered HTML would carry no nonce and its scripts would be
    blocked. Acceptable while Cache Components are off (D-008); revisit with the storefront caching
    design. The web 404 is rendered by `[locale]/not-found.tsx` (catch-all `[locale]/[...rest]`) for
    the same reason.
  - Verified by unit tests (`packages/security-headers`) and `pnpm check:csp` (after `pnpm build`:
    starts both apps and checks every header and that every `<script>`/`<style>` carries the
    response nonce).
- **CSP violation reporting (T-013, extends D-031):**
  - **Policy:** when reporting is on, the CSP ends with `report-uri /api/csp-report` (Firefox) and
    `report-to csp` (Chromium), and responses carry `Reporting-Endpoints: csp="/api/csp-report"`.
    `CSP_REPORTING=on|off` (`@igs/config` `cspEnv`); empty/unset → **on in production, off in `next dev`**
    (the dev overlay's known violations would only be noise).
  - **Sink:** `POST /api/csp-report` in both apps (thin `route.ts`; logic in `@igs/security-headers`
    `handleCspReport`). Stateless: no DB, no kernel, no auth, no cookies. Accepts
    `application/csp-report` and `application/reports+json` only (else **415**); body capped at
    **16 KB on the stream** (`content-length` not trusted; over → **413**); Zod-parsed, unknown keys
    stripped (malformed → **400**); accepted → **204**. Non-`csp-violation` reports in a batch are
    ignored.
  - **Logged** (`warn`, event `security.csp.violation`): directive (known CSP directive names, else
    `other`), disposition, status/line/column numbers, and `document-uri`, `blocked-uri`,
    `source-file`, `referrer` reduced to **origin + path** (non-HTTP URLs to their scheme; `blocked-uri`
    keywords such as `inline`/`eval`/`data`/`blob` kept).
  - **Never logged:** query strings, fragments, URL credentials, `script-sample`/`sample`,
    `original-policy`, any other field, **IP address or user agent** (the handler never reads them).
  - **Metrics:** `security.csp.violation` labelled by `directive` only and
    `security.csp.report_dropped`; wired as a no-op until the OTel backend lands (Phase 1b).
  - **Flood guard:** per-process token bucket, 60 logged reports/minute; further reports are still
    counted but not logged, and the drops are reported at most once per minute as a
    `security.csp.report_dropped` increment **and** one `warn` line `{ dropped: n }` (visible in the
    logs while metrics are a no-op). The summary is emitted lazily: by the first report that arrives
    after the minute has passed, so a burst followed by silence is summarised only when traffic resumes. Real rate limiting is B-10.
  - Browsers send reports to the HTTPS origin: on plain-HTTP `localhost`, `upgrade-insecure-requests`
    upgrades the report request, so test delivery behind TLS (verified with Chromium for T-013).
    `pnpm check:csp` covers the headers, both formats (204), 413 and 415 on both apps, and that the
    server logs contain no query string, sample or user agent.
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
