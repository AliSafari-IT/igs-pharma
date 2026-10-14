import { describe, expect, it } from "vitest";

import { isInteractiveRequest } from "../src/server/activity";

const request = (headers: Record<string, string>) => new Headers(headers);

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
});
