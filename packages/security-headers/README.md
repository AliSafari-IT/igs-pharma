# @igs/security-headers

The security-header policy for both Next.js apps (T-011, D-031; `docs/03-architecture/security-architecture.md` §5).
Infra package: no Next import, imports nothing in-repo (`zod` is its only runtime dependency, for report parsing).

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

## Violation reporting (T-013)

```ts
// proxy.ts — only when CSP_REPORTING is on (cspReportingEnabled() from @igs/config)
buildSecurityHeaders({ nonce, app: "web", isDev: false, reportPath: CSP_REPORT_PATH });

// app/api/csp-report/route.ts
const guard = createFloodGuard({ perMinute: 60 });
export const POST = (request: Request) => handleCspReport(request, sink, guard);
```

`handleCspReport` accepts `application/csp-report` and `application/reports+json` (else 415), caps the
body at 16 KB on the stream (413), Zod-parses it (400), sanitises it (origin + path only; no samples,
IP or user agent) and hands it to the `sink` port (204); the app wires `sink.warn` to the logger. The
package still imports nothing in-repo; `zod` is its only runtime dependency.

