import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isInteractiveRequest } from "../src/server/activity";

/** A request the way a browser sends it from one of our own pages. */
const request = (headers: Record<string, string>) =>
  new Headers({ "sec-fetch-site": "same-origin", ...headers });

describe("what counts as the person's own activity (#95)", () => {
  it("a page navigation or form post is interactive", () => {
    expect(isInteractiveRequest(request({ "sec-fetch-dest": "document" }))).toBe(true);
  });

  it("a Server Action is interactive", () => {
    expect(isInteractiveRequest(request({ "next-action": "abc123" }))).toBe(true);
  });

  it("a client-side navigation (RSC request) is interactive", () => {
    expect(isInteractiveRequest(request({ rsc: "1", "sec-fetch-dest": "empty" }))).toBe(true);
  });

  it("prefetches are background, whatever else they carry", () => {
    expect(isInteractiveRequest(request({ rsc: "1", "next-router-prefetch": "1" }))).toBe(false);
    expect(
      isInteractiveRequest(request({ "sec-fetch-dest": "document", purpose: "prefetch" })),
    ).toBe(false);
    expect(
      isInteractiveRequest(request({ "sec-fetch-dest": "document", "sec-purpose": "prefetch" })),
    ).toBe(false);
  });

  it("anything marked as background is, even if it looks like a navigation", () => {
    expect(
      isInteractiveRequest(request({ "sec-fetch-dest": "document", "x-igs-background": "1" })),
    ).toBe(false);
    expect(isInteractiveRequest(request({ "next-action": "abc", "x-igs-background": "1" }))).toBe(
      false,
    );
  });

  it("a request that is not positively recognised is background (health checks, polling, curl)", () => {
    expect(isInteractiveRequest(request({}))).toBe(false);
    expect(isInteractiveRequest(request({ "sec-fetch-dest": "empty" }))).toBe(false);
    expect(isInteractiveRequest(request({ accept: "application/json" }))).toBe(false);
  });

  it("needs the browser's own Sec-Fetch-Site: a script adding next-action or rsc is background (#100)", () => {
    const bare = (headers: Record<string, string>) => new Headers(headers);
    expect(isInteractiveRequest(bare({ "next-action": "abc123" }))).toBe(false);
    expect(isInteractiveRequest(bare({ rsc: "1" }))).toBe(false);
    expect(isInteractiveRequest(bare({ "sec-fetch-dest": "document" }))).toBe(false);
    expect(
      isInteractiveRequest(request({ "sec-fetch-site": "cross-site", "next-action": "abc" })),
    ).toBe(false);
    expect(
      isInteractiveRequest(request({ "sec-fetch-site": "none", "sec-fetch-dest": "document" })),
    ).toBe(true);
  });
});

describe("full prefetches (#110)", () => {
  it("the auto prefetch is background", () => {
    expect(isInteractiveRequest(request({ rsc: "1", "next-router-prefetch": "1" }))).toBe(false);
  });

  it("a full prefetch looks exactly like a navigation, so no source file may ask for one", () => {
    // Next 16 sends the same headers for `<Link prefetch={true}>` and for a click; this guard keeps
    // the idle clock honest by keeping full prefetches out of the platform altogether
    const root = fileURLToPath(new URL("../src", import.meta.url));
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name))
          : /\.(ts|tsx)$/.test(entry.name)
            ? [join(dir, entry.name)]
            : [],
      );
    const offenders = walk(root).filter((file) =>
      /prefetch\s*=\s*(\{\s*true\s*\}|"true")|prefetch(?=[\s/>])(?!\s*=)/.test(
        readFileSync(file, "utf8").replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ""),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
