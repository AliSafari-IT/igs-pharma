/**
 * T-011 scripted check: `next start` both built apps and verify that HTML responses carry the
 * security headers and that every <script>/<style> tag carries the response's CSP nonce.
 * Run after `pnpm build`: `pnpm check:csp`. No dependencies (Node fetch + child_process).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const apps = [
  { app: "web", port: 3000, paths: ["/nl", "/fr", "/de", "/en", "/nl/does-not-exist"] },
  { app: "platform", port: 3001, paths: ["/", "/does-not-exist"] },
];

const COMMON = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "cross-origin-opener-policy": "same-origin",
  "x-frame-options": "DENY",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
};

function start({ app, port }) {
  // fake values: the env schema only needs valid-looking ones (no DB access on these pages)
  const env = {
    DATABASE_URL: "postgresql://check:check@localhost:5432/check",
    AUTH_SECRET: "check-only-placeholder-not-a-secret-000",
    AUTH_URL: `http://localhost:${port}`,
    ...process.env,
    NODE_ENV: "production",
  };
  return spawn("pnpm", ["--filter", `@igs/${app}`, "exec", "next", "start", "--port", `${port}`], {
    cwd: root,
    env,
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
}

async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(url, { redirect: "manual" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`${url} did not come up`);
}

async function check(app, url, previousNonces) {
  const res = await fetch(url, { redirect: "manual" });
  assert.match(res.headers.get("content-type") ?? "", /text\/html/, `${url}: not HTML`);
  for (const [name, value] of Object.entries(COMMON)) {
    assert.equal(res.headers.get(name), value, `${url}: ${name}`);
  }
  if (app === "platform") {
    assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow", `${url}: x-robots-tag`);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/, `${url}: cache-control`);
  }

  const csp = res.headers.get("content-security-policy") ?? "";
  const nonce = /script-src 'self' 'nonce-([A-Za-z0-9+/=]+)' 'strict-dynamic'/.exec(csp)?.[1];
  assert.ok(nonce, `${url}: no nonce in script-src: ${csp}`);
  assert.ok(csp.includes(`style-src 'self' 'nonce-${nonce}'`), `${url}: style-src nonce`);
  assert.ok(!/unsafe-(eval|inline)/.test(csp), `${url}: unsafe-* in production CSP`);
  assert.ok(!previousNonces.has(nonce), `${url}: nonce reused`);
  previousNonces.add(nonce);

  const html = await res.text();
  const tags = html.match(/<(script|style)\b[^>]*>/g) ?? [];
  assert.ok(
    tags.some((t) => t.startsWith("<script")),
    `${url}: no <script> tags rendered`,
  );
  for (const tag of tags) {
    assert.ok(tag.includes(`nonce="${nonce}"`), `${url}: tag without the response nonce: ${tag}`);
  }
  console.info(`ok ${url} (${res.status}, ${tags.length} script/style tags carry the nonce)`);
  return csp;
}

/**
 * /api/health must reach its route handler at its own path (no locale redirect). The status is 200
 * with a reachable database and 503 "degraded" without one (this check runs without a database);
 * either way the handler's JSON proves the route was not rerouted. No CSP needed on JSON.
 */
async function checkApi(url) {
  const res = await fetch(url, { redirect: "manual" });
  assert.equal(res.headers.get("location"), null, `${url}: redirected`);
  assert.ok([200, 503].includes(res.status), `${url}: unexpected status ${res.status}`);
  const body = await res.json();
  const expected = res.status === 200 ? "ok" : "degraded";
  assert.equal(body.status, expected, `${url}: health status mismatch (HTTP ${res.status})`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff", `${url}: nosniff`);
  console.info(`ok ${url} (${res.status} ${body.status}, served by the route handler)`);
}

const servers = apps.map(start);
let failed = false;
try {
  const nonces = new Set();
  for (const { app, port, paths } of apps) {
    await waitFor(`http://localhost:${port}/api/health`);
    await checkApi(`http://localhost:${port}/api/health`);
    if (app === "web") {
      // only /api and /api/* skip the proxy: a slug that merely starts with "api" is still localized
      const res = await fetch(`http://localhost:${port}/apixaban`, { redirect: "manual" });
      assert.equal(res.headers.get("location"), "/nl/apixaban", "/apixaban: locale redirect");
      console.info("ok /apixaban -> /nl/apixaban (locale redirect kept)");
    }
    for (const p of paths) {
      const csp = await check(app, `http://localhost:${port}${p}`, nonces);
      if (p === paths[0]) console.info(`  ${app} CSP: ${csp}`);
    }
  }
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  for (const server of servers) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {}
  }
}
process.exit(failed ? 1 : 0);
