// igs-pharma#220: the audit trail page's filters, Brussels days and actor labels.
import { describe, expect, it } from "vitest";

import {
  actorLabel,
  addDays,
  auditHref,
  brusselsDay,
  brusselsDayStart,
  filtersOf,
} from "../src/components/audit-labels";

describe("Brussels days", () => {
  it("a day starts at Brussels midnight, in winter and in summer", () => {
    expect(brusselsDayStart("2026-01-15")?.toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(brusselsDayStart("2026-07-15")?.toISOString()).toBe("2026-07-14T22:00:00.000Z");
    // the days the clock changes: midnight is still before the change
    expect(brusselsDayStart("2026-03-29")?.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(brusselsDayStart("2026-10-25")?.toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });

  it("refuses what is not a real day", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "26-01-01", "today", ""]) {
      expect(brusselsDayStart(bad), bad).toBeNull();
    }
  });

  it("reads the Brussels date of an instant and counts days", () => {
    expect(brusselsDay(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-11-01", -29)).toBe("2026-10-03");
  });
});

describe("filtersOf", () => {
  const now = new Date("2026-11-01T10:00:00Z");

  it("defaults to the last 30 days ending today", () => {
    expect(filtersOf({}, now)).toEqual({
      fromDay: "2026-10-03",
      toDay: "2026-11-01",
      refused: false,
      page: 1,
    });
  });

  it("keeps valid filters and drops bad dates and pages", () => {
    expect(
      filtersOf(
        {
          from: "2026-10-01",
          to: "2026-10-31",
          action: " identity.early_access. ",
          actor: "u-1",
          entity: "r-1",
          refused: "1",
          page: "3",
        },
        now,
      ),
    ).toEqual({
      fromDay: "2026-10-01",
      toDay: "2026-10-31",
      action: "identity.early_access.",
      actorId: "u-1",
      entityId: "r-1",
      refused: true,
      page: 3,
    });
    expect(filtersOf({ from: "2026-12-01", to: "2026-11-01", page: "-2" }, now)).toMatchObject({
      fromDay: "2026-10-03",
      toDay: "2026-11-01",
      page: 1,
    });
  });

  it("builds the URL of another page with the same filters", () => {
    const filters = filtersOf({ from: "2026-10-01", to: "2026-10-31", refused: "1" }, now);
    expect(auditHref(filters, 2)).toBe("/audit?from=2026-10-01&to=2026-10-31&refused=1&page=2");
  });
});

describe("actorLabel", () => {
  const names = new Map([["staff-1", "An Peeters"]]);
  it("names staff, and says what kind of actor anyone else is", () => {
    expect(actorLabel("user", "staff-1", names)).toBe("An Peeters");
    expect(actorLabel("user", "0198c2a7-aaaa-bbbb", names)).toBe("Account 0198c2a7…");
    expect(actorLabel("anonymous", "storefront-guest", names)).toBe("Anonymous visitor");
    expect(actorLabel("system", "worker", names)).toBe("System (worker)");
  });
});
