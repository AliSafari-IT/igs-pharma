// The back-office is reachable from any network (no IP allowlist at the edge), so every page, route
// and Server Action must ask for a staff session itself (D-005: authorization lives in the page or
// action, never in the proxy). This walks `src/app` and fails on anything new that does not.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const APP = fileURLToPath(new URL("../src/app", import.meta.url));

/**
 * The only entries open without a staff session, and why. Anything else under `src/app` that is a
 * page, a route handler or a Server Action calls `requireStaffActor()`.
 */
const OPEN: Readonly<Record<string, string>> = {
  "sign-in/page.tsx": "the passkey sign-in form",
  "enrol/page.tsx": "lands a bootstrap enrolment link; the token is redeemed by /api/auth",
  "setup/page.tsx": "2-step setup for a signed-in, not yet verified session; signed out it says so",
  "api/health/route.ts": "container health check, no data",
  "api/health/live/route.ts": "container liveness check, no data",
  "api/auth/[...all]/route.ts": "Better Auth: each endpoint checks its own session, rate limited",
  // exceptions beyond sign-in, enrolment, setup and health:
  "page.tsx": "home: signed out it shows only a sign-in link; signed in it calls requireStaffActor",
  "account/page.tsx":
    "signed out it shows only a sign-in prompt; it shows nothing but the actor's own",
  "api/csp-report/route.ts":
    "browser CSP violation reports: stateless, flood-guarded, stores nothing",
  "dev/ui/page.tsx": "component gallery with fake data; a 404 in production unless UI_GALLERY=on",
};

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/** A Server Action module, whatever its file name: it starts with the directive. */
const isServerActions = (path: string) =>
  /\.tsx?$/.test(path) && readFileSync(join(APP, path), "utf8").startsWith('"use server";');

const entries = files(APP)
  .map((path) => relative(APP, path).split("\\").join("/"))
  .filter((path) => /(^|\/)(page\.tsx|route\.ts)$/.test(path) || isServerActions(path));

/** The exported async functions of a Server Action file, each with its body. */
function exportedActions(source: string): { name: string; body: string }[] {
  const chunks = source.split(/\n(?=export |async function |function |const |interface |type )/);
  return chunks.flatMap((chunk) => {
    // `export async function name` or `export const name = async (…) =>`
    const match = /^export (?:async function (\w+)|const (\w+) = async\b)/.exec(chunk);
    const name = match?.[1] ?? match?.[2];
    return name ? [{ name, body: chunk }] : [];
  });
}

/** Local helpers (not exported) that call `requireStaffActor()` themselves. */
function guardedHelpers(source: string): string[] {
  const chunks = source.split(/\n(?=export |async function |function |const )/);
  return chunks.flatMap((chunk) => {
    const name = /^(?:async function|function|const) (\w+)/.exec(chunk)?.[1];
    return name && chunk.includes("requireStaffActor()") ? [name] : [];
  });
}

describe("every back-office page, route and Server Action needs a staff session", () => {
  it("finds the app's entries (the walk works)", () => {
    expect(entries).toContain("staff/page.tsx");
    expect(entries).toContain("staff/actions.ts");
    for (const open of Object.keys(OPEN)) expect(entries).toContain(open);
  });

  for (const entry of entries.filter((e) => !(e in OPEN))) {
    const source = readFileSync(join(APP, entry), "utf8");

    if (isServerActions(entry)) {
      it(`${entry}: every action asks for a staff session`, () => {
        expect(source.startsWith('"use server";')).toBe(true);
        const helpers = guardedHelpers(source);
        const actions = exportedActions(source);
        expect(actions.length).toBeGreaterThan(0);
        for (const { name, body } of actions) {
          const guarded =
            body.includes("requireStaffActor()") ||
            helpers.some((helper) => body.includes(`${helper}(`));
          expect(guarded, `${entry}: ${name}`).toBe(true);
        }
      });
    } else {
      it(`${entry}: asks for a staff session`, () => {
        expect(source).toContain("await requireStaffActor()");
      });
    }
  }
});

// --- requireStaffActor itself ----------------------------------------------------------------------

const resolveSession = vi.fn();
const requestHeaders = { current: new Headers() };

vi.mock("next/headers", () => ({ headers: async () => requestHeaders.current }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("../src/server/kernel", () => ({ ensureAuthConfigured: () => {} }));
vi.mock("@igs/auth", () => ({
  resolveSession: (...args: unknown[]) => resolveSession(...args),
  sessionTokenFromCookies: (cookie: string | null) =>
    /better-auth\.session_token=([^;.]+)/.exec(cookie ?? "")?.[1] ?? null,
}));

const actor = (kind: string, mfaVerified: boolean) => ({ kind, mfaVerified });

describe("requireStaffActor", () => {
  beforeEach(() => {
    vi.resetModules();
    resolveSession.mockReset();
    requestHeaders.current = new Headers({ cookie: "better-auth.session_token=abc.sig" });
  });

  const load = async () => (await import("../src/server/actor")).requireStaffActor();

  it("sends a request without a session cookie to sign in, without asking the database", async () => {
    requestHeaders.current = new Headers();
    await expect(load()).rejects.toThrow("redirect:/sign-in");
    expect(resolveSession).not.toHaveBeenCalled();
  });

  it("sends an unknown session (resolveSession: null, e.g. a customer's) to sign in", async () => {
    resolveSession.mockResolvedValue(null);
    await expect(load()).rejects.toThrow("redirect:/sign-in");
  });

  it("says why when the session just ended", async () => {
    resolveSession.mockResolvedValue({ ended: "idle" });
    await expect(load()).rejects.toThrow("redirect:/sign-in?reason=idle");
  });

  it("sends staff who have not done 2-step login to /setup", async () => {
    resolveSession.mockResolvedValue({ actor: actor("staff", false) });
    await expect(load()).rejects.toThrow("redirect:/setup");
  });

  it("lets a verified staff session through", async () => {
    const staff = actor("staff", true);
    resolveSession.mockResolvedValue({ actor: staff });
    await expect(load()).resolves.toBe(staff);
  });
});
