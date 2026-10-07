# @igs/security-headers

The security-header policy for both Next.js apps (T-011, D-031; `docs/03-architecture/security-architecture.md` §5).
Pure infra package: no runtime dependencies, no Next import, imports nothing in-repo.

```ts
import { buildSecurityHeaders, generateNonce } from "@igs/security-headers";

const nonce = generateNonce(); // 128-bit, base64, Web Crypto — one per request
const headers = buildSecurityHeaders({ nonce, app: "web", isDev: false });
// { "content-security-policy": "default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; …", … }
```

- `app: "platform"` adds `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`.
- `isDev: true` adds `'unsafe-eval'` and `ws: wss:` for `next dev`, and drops HSTS and `upgrade-insecure-requests`.
- A nonce that is not base64 throws (it ends up in a header and in HTML attributes).

Used by `apps/web/src/proxy.ts` and `apps/platform/src/proxy.ts`, which put the CSP on the forwarded
request (Next reads the nonce from it) and all headers on the response. Change the policy here, never
in an app, and update the tests and §5 with it. **No authorization in `proxy.ts` (D-005).**
