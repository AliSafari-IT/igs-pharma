import { afterEach, describe, expect, it } from "vitest";

import {
  DomainError,
  conflict,
  forbidden,
  invariant,
  isDomainError,
  notFound,
  toErrorResponse,
  validationFailed,
} from "../src";
import { configureKernelForTests, resetKernelForTests } from "../src/testing";

afterEach(() => resetKernelForTests());

describe("DomainError", () => {
  it("carries a stable code and no human text", () => {
    const error = notFound("orders.not_found", { orderId: "o-1" });
    expect(error).toBeInstanceOf(DomainError);
    expect(isDomainError(error)).toBe(true);
    expect(error.kind).toBe("NotFound");
    expect(error.code).toBe("orders.not_found");
    expect(error.message).toBe("orders.not_found"); // the code itself — nothing to translate
    expect(error.details).toEqual({ orderId: "o-1" });
  });

  it("isDomainError rejects everything else", () => {
    expect(isDomainError(new Error("x"))).toBe(false);
    expect(isDomainError({ kind: "NotFound", code: "x" })).toBe(false);
  });
});

describe("toErrorResponse (edge helper, D-006)", () => {
  it.each([
    [forbidden("a.b"), 403],
    [notFound("a.b"), 404],
    [conflict("a.b"), 409],
    [validationFailed("a.b", [{ path: "x", code: "invalid_type" }]), 422],
    [invariant("a.b"), 500],
  ])("maps %s to HTTP %s with the same code", (error, status) => {
    expect(toErrorResponse(error)).toMatchObject({ status, code: "a.b" });
  });

  it("passes details and field issues through (and nothing else)", () => {
    const response = toErrorResponse(
      validationFailed("kernel.validation_failed", [{ path: "items.0.qty", code: "too_small" }]),
    );
    expect(response).toEqual({
      status: 422,
      code: "kernel.validation_failed",
      fields: [{ path: "items.0.qty", code: "too_small" }],
    });
  });

  it("maps unknown errors to 500 kernel.internal and logs the original", () => {
    const handles = configureKernelForTests();
    const response = toErrorResponse(new Error("connection reset"));
    expect(response).toEqual({ status: 500, code: "kernel.internal" });
    expect(handles.errors).toHaveLength(1);
    expect(JSON.stringify(handles.errors[0])).toContain("connection reset");
  });

  it("handles non-Error throwables", () => {
    configureKernelForTests();
    expect(toErrorResponse("boom")).toEqual({ status: 500, code: "kernel.internal" });
  });
});
