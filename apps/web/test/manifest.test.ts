import { Ajv2020 } from "ajv/dist/2020";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import manifest from "../platform.app.json";
import { GET as getManifest } from "../src/app/.well-known/asafarim-app.json/route";
import { GET as getLive } from "../src/app/api/health/live/route";
import proxy from "../src/proxy";
// Vendored from AliSafari-IT/asafarim-os packages/app-manifest/schema/app-manifest.schema.json at
// e58ee4d262b84f8ed573b6d9b18517212ce03eec (file last changed in 66431cc). The @asafarim/*
// packages aren't published, so re-copy it when the OS schema changes.
import schema from "./app-manifest.schema.json";

const WELL_KNOWN = "/.well-known/asafarim-app.json";

describe("ASafariM OS manifest (platform.app.json)", () => {
  it("is valid against the OS JSON Schema", () => {
    const validate = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true }).compile(
      schema,
    );
    expect(validate(manifest), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("gives the OS no say over pharmacy sign-in or permissions", () => {
    expect(manifest.auth.client).toBe("none");
    expect(manifest.permissions).toEqual([]);
    expect(manifest.roles).toEqual([]);
  });

  it("matches the deployment: published images, the gated storefront, CSP reports (#91)", () => {
    expect(manifest.runtime.image).toBe("ghcr.io/alisafari-it/igs-pharma-web");
    expect(manifest.runtime.workers.map((w) => w.image)).toEqual([
      "ghcr.io/alisafari-it/igs-pharma-worker",
    ]);
    // closed by SITE_GATE (coming-soon) until Gate 1
    expect(manifest.ui.status).toBe("coming-soon");
    // the proxy lets these through the gate (src/proxy.ts isOpenPath)
    expect(manifest.auth.publicPaths).toEqual(
      expect.arrayContaining(["/api/health", "/api/health/live", "/api/csp-report"]),
    );
  });

  it("keeps health and the manifest itself public", () => {
    const { live, ready } = manifest.runtime.health;
    expect(manifest.auth.publicPaths).toEqual(expect.arrayContaining([live, ready, WELL_KNOWN]));
  });
});

describe(`GET ${WELL_KNOWN}`, () => {
  it("returns the manifest file as uncached JSON", async () => {
    const res = getManifest();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(manifest);
  });

  it("passes the proxy without a locale redirect and gets the security headers", () => {
    const res = proxy(new NextRequest(`http://localhost:3000${WELL_KNOWN}`));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("GET /api/health/live", () => {
  it("answers without touching the database and shows no version", async () => {
    const res = getLive();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
