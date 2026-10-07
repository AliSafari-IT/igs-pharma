import { describe, expect, it } from "vitest";

import { CSP_REPORT_PATH, buildSecurityHeaders, generateNonce } from "./index";

const nonce = generateNonce();
const prod = (app: "web" | "platform") => buildSecurityHeaders({ nonce, app, isDev: false });
const dev = (app: "web" | "platform") => buildSecurityHeaders({ nonce, app, isDev: true });

/** CSP as a directive → sources map. */
function csp(headers: Record<string, string>): Map<string, string[]> {
  const value = headers["content-security-policy"];
  expect(value).toBeDefined();
  return new Map(
    (value ?? "").split("; ").map((d) => {
      const [name = "", ...sources] = d.split(" ");
      return [name, sources];
    }),
  );
}

describe("generateNonce", () => {
  it("returns 128 random bits as base64, new on each call", () => {
    const nonces = new Set(Array.from({ length: 100 }, generateNonce));
    expect(nonces.size).toBe(100);
    for (const n of nonces) {
      expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(Buffer.from(n, "base64")).toHaveLength(16);
    }
  });
});

describe("buildSecurityHeaders", () => {
  it.each(["web", "platform"] as const)("%s: sends every baseline header in production", (app) => {
    expect(prod(app)).toMatchObject({
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy":
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
      "cross-origin-opener-policy": "same-origin",
      "x-frame-options": "DENY",
      "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
    });
  });

  it.each(["web", "platform"] as const)("%s: production CSP is exactly the D-031 policy", (app) => {
    expect(prod(app)["content-security-policy"]).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
        `style-src 'self' 'nonce-${nonce}'`,
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
      ].join("; "),
    );
  });

  it("embeds the nonce in script-src and style-src, never 'unsafe-inline'", () => {
    const policy = csp(prod("web"));
    expect(policy.get("script-src")).toContain(`'nonce-${nonce}'`);
    expect(policy.get("style-src")).toContain(`'nonce-${nonce}'`);
    expect(prod("web")["content-security-policy"]).not.toContain("unsafe-inline");
  });

  it("production: no 'unsafe-eval', no websocket sources", () => {
    const policy = csp(prod("web"));
    expect(policy.get("script-src")).not.toContain("'unsafe-eval'");
    expect(policy.get("connect-src")).toEqual(["'self'"]);
  });

  it("dev: allows eval and the HMR websocket, drops HSTS and upgrade-insecure-requests", () => {
    const headers = dev("web");
    const policy = csp(headers);
    expect(policy.get("script-src")).toContain("'unsafe-eval'");
    expect(policy.get("connect-src")).toEqual(["'self'", "ws:", "wss:"]);
    expect(policy.has("upgrade-insecure-requests")).toBe(false);
    expect(headers["strict-transport-security"]).toBeUndefined();
    // everything else stays strict in dev
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
  });

  it("platform only: noindex and no-store", () => {
    for (const headers of [prod("platform"), dev("platform")]) {
      expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
      expect(headers["cache-control"]).toBe("no-store");
    }
    for (const headers of [prod("web"), dev("web")]) {
      expect(headers["x-robots-tag"]).toBeUndefined();
      expect(headers["cache-control"]).toBeUndefined();
    }
  });

  it("uses the nonce it is given (a new nonce per request means a new policy)", () => {
    const other = generateNonce();
    const policy = buildSecurityHeaders({ nonce: other, app: "web", isDev: false });
    expect(policy["content-security-policy"]).toContain(`'nonce-${other}'`);
    expect(policy["content-security-policy"]).not.toContain(nonce);
  });

  it.each(["", "abc", "x'; script-src *", '"><script>'])("rejects a malformed nonce %j", (bad) => {
    expect(() => buildSecurityHeaders({ nonce: bad, app: "web", isDev: false })).toThrow(/nonce/);
  });
});

describe("violation reporting (T-013)", () => {
  const reporting = (app: "web" | "platform", isDev = false) =>
    buildSecurityHeaders({ nonce, app, isDev, reportPath: CSP_REPORT_PATH });

  it.each(["web", "platform"] as const)(
    "%s: report-uri, report-to and Reporting-Endpoints",
    (app) => {
      const headers = reporting(app);
      const policy = csp(headers);
      expect(policy.get("report-uri")).toEqual(["/api/csp-report"]);
      expect(policy.get("report-to")).toEqual(["csp"]);
      expect(headers["reporting-endpoints"]).toBe('csp="/api/csp-report"');
    },
  );

  it("leaves the rest of the policy unchanged", () => {
    const withReporting = reporting("web")["content-security-policy"] ?? "";
    expect(withReporting).toBe(
      `${prod("web")["content-security-policy"]}; report-uri /api/csp-report; report-to csp`,
    );
    const { "content-security-policy": _a, "reporting-endpoints": _b, ...rest } = reporting("web");
    const { "content-security-policy": _c, ...base } = prod("web");
    expect(rest).toEqual(base);
  });

  it("no reportPath → no reporting directives or header (prod and dev)", () => {
    for (const headers of [prod("web"), prod("platform"), dev("web"), dev("platform")]) {
      expect(headers["content-security-policy"]).not.toMatch(/report-(uri|to)/);
      expect(headers["reporting-endpoints"]).toBeUndefined();
    }
  });

  it.each(["api/csp-report", "https://evil.example/r", '/x"; y', "/a b"])(
    "rejects an unsafe reportPath %j",
    (bad) => {
      expect(() =>
        buildSecurityHeaders({ nonce, app: "web", isDev: false, reportPath: bad }),
      ).toThrow(/reportPath/);
    },
  );
});
