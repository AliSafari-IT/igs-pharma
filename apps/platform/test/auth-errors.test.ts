import { describe, expect, it, vi } from "vitest";

import { authErrorMessage, withFreshPasskey } from "../src/components/auth-errors";

const fresh = { error: { code: "FRESH_PASSKEY_REQUIRED", status: 403 } };

describe("FRESH_PASSKEY_REQUIRED (#100)", () => {
  it("has its own text", () => {
    expect(authErrorMessage(fresh.error)).toMatch(/passkey/i);
  });

  it("asks for the passkey once and retries the action", async () => {
    const action = vi.fn().mockResolvedValueOnce(fresh).mockResolvedValueOnce({ data: "ok" });
    const check = vi.fn().mockResolvedValue({ error: null });
    expect(await withFreshPasskey(action, check)).toEqual({ data: "ok" });
    expect(check).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("does not ask when the action goes through, or fails for another reason", async () => {
    const check = vi.fn();
    expect(await withFreshPasskey(async () => ({ data: 1 }), check)).toEqual({ data: 1 });
    const other = { error: { code: "MFA_REQUIRED" } };
    expect(await withFreshPasskey(async () => other, check)).toBe(other);
    expect(check).not.toHaveBeenCalled();
  });

  it("stops with the check's own error when the passkey check fails, without retrying", async () => {
    const action = vi.fn().mockResolvedValue(fresh);
    const failed = { error: { code: "USER_VERIFICATION_REQUIRED" } };
    expect(await withFreshPasskey(action, async () => failed)).toBe(failed);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
