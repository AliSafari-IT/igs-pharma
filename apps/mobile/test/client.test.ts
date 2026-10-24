import { describe, expect, it, vi } from "vitest";
import { ApiError, errorKind, getJson } from "../src/api/client";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("errorKind", () => {
  it("reads the storefront's answers as the screens show them", () => {
    expect(errorKind(503, "coming_soon")).toBe("closed");
    expect(errorKind(503, "unavailable")).toBe("unavailable");
    expect(errorKind(404, "not_found")).toBe("not_found");
    expect(errorKind(400, "invalid_input")).toBe("invalid");
    expect(errorKind(500, undefined)).toBe("unavailable");
  });
});

describe("getJson", () => {
  it("builds the v1 URL with encoded parameters and drops empty ones", async () => {
    const fetchImpl = vi.fn(async () => json(200, { ok: true }));
    await getJson(
      "/products",
      { locale: "fr", q: "crème solaire", category: undefined, page: 2 },
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://igs-pharma.be/api/mobile/v1/products?locale=fr&q=cr%C3%A8me%20solaire&page=2",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
  });

  it("returns the body of a 2xx answer", async () => {
    expect(await getJson("/pharmacy", {}, async () => json(200, { name: "IGS-Pharma" }))).toEqual({
      name: "IGS-Pharma",
    });
  });

  it("turns a closed storefront into 'closed'", async () => {
    await expect(
      getJson("/products", {}, async () => json(503, { error: "coming_soon" })),
    ).rejects.toEqual(new ApiError("closed"));
  });

  it("turns no answer into 'offline' and an HTML page into 'unavailable'", async () => {
    await expect(
      getJson("/products", {}, async () => {
        throw new TypeError("Network request failed");
      }),
    ).rejects.toMatchObject({ kind: "offline" });
    await expect(
      getJson(
        "/products",
        {},
        async () => new Response("<html>coming soon</html>", { status: 200 }),
      ),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });
});
