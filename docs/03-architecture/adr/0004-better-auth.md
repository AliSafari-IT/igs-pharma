# 0004 — Better Auth for authentication; itsme® for Phase 2 identity

- Status: Proposed
- Date: 2026-10-07

## Context
We need customer and staff auth, passkeys, MFA, roles, sessions in our own EU database, and in
Phase 2 strong identity proofing (Belgian itsme® / eID).

## Decision
- **Better Auth** (TypeScript library, self-hosted, Drizzle adapter) — e-mail/password (Argon2id),
  passkeys (WebAuthn), TOTP 2FA, session management, organization/admin plugins, generic OIDC
  for itsme® and optional staff SSO (Entra ID).
- Separate cookie domains for `web` and `platform`; staff require passkey.
- Authorization (RBAC/ABAC) is our own layer — not delegated to the auth library.

## Consequences
- ✅ No third-party identity SaaS holding patient identities; full control of data residency.
- ⚠️ We own security patching of the auth layer → Renovate + advisories monitoring.

## Alternatives considered
- **Keycloak / Zitadel** (self-hosted IdP) — robust, but another service to operate; reconsider if
  multiple apps/partners need SSO.
- **Clerk / Auth0** — excellent DX; US-based processors for health-adjacent identities → rejected.
- **Auth.js** — now maintained under the Better Auth umbrella; Better Auth is the forward path.
