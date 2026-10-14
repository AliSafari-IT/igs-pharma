import { VISIBILITY_REASON_CODES, type VisibilityReason } from "@igs/module-storefront";
import { describe, expect, it } from "vitest";

import { visibilityReasonLabel } from "../src/components/storefront-labels";

describe("visibilityReasonLabel", () => {
  const reasons: VisibilityReason[] = [
    { code: "draft" },
    { code: "archived" },
    { code: "prescription_only" },
    { code: "no_price" },
    { code: "text_not_approved", locales: ["nl", "fr"] },
  ];

  it("has its own sentence for every reason the module can give", () => {
    expect(reasons.map((r) => r.code).sort()).toEqual([...VISIBILITY_REASON_CODES].sort());
    const labels = reasons.map(visibilityReasonLabel);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label).toMatch(/\.$/);
  });

  it("names the locales whose text still needs a pharmacist", () => {
    expect(visibilityReasonLabel({ code: "text_not_approved", locales: ["fr"] })).toBe(
      "A pharmacist has not approved the French text of this medicine yet.",
    );
    expect(visibilityReasonLabel({ code: "text_not_approved", locales: ["nl", "fr"] })).toMatch(
      /Dutch and French/,
    );
  });
});
