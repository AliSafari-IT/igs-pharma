import { ROLES, ROLE_KEYS } from "@igs/rbac";
import { describe, expect, it } from "vitest";

import { STAFF_ROLE_LABELS, staffRoleSummary } from "../src/lib/role-labels";

describe("STAFF_ROLE_LABELS", () => {
  it("names every staff role of the catalogue, and nothing else", () => {
    const staff = ROLE_KEYS.filter((role) => ROLES[role].kind === "staff");
    expect(Object.keys(STAFF_ROLE_LABELS).sort()).toEqual([...staff].sort());
    for (const label of Object.values(STAFF_ROLE_LABELS)) expect(label.trim()).not.toBe("");
  });
});

describe("staffRoleSummary", () => {
  it("names a single role", () => {
    expect(staffRoleSummary(["owner"])).toBe("Owner");
    expect(staffRoleSummary(["content_editor"])).toBe("Content editor");
  });

  it("lists several roles in catalogue order, whatever order they come in", () => {
    expect(staffRoleSummary(["content_editor", "pharmacist", "owner"])).toBe(
      "Owner, Pharmacist, Content editor",
    );
  });

  it("leaves out customer, system and unknown keys", () => {
    expect(staffRoleSummary(["customer", "system_seed", "made_up", "pharmacy_assistant"])).toBe(
      "Pharmacy assistant",
    );
  });

  it("is empty when no staff role is held", () => {
    expect(staffRoleSummary([])).toBe("");
    expect(staffRoleSummary(["customer"])).toBe("");
  });

  it("does not repeat a role held twice", () => {
    expect(staffRoleSummary(["owner", "owner"])).toBe("Owner");
  });

  it("does not match prototype keys", () => {
    expect(staffRoleSummary(["toString", "constructor"])).toBe("");
  });
});
