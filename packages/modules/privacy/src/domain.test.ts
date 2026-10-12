import { describe, expect, it } from "vitest";

import {
  DSR_STATUSES,
  type DsrStatus,
  canMoveDsr,
  daysUntil,
  dsrDueAt,
  isDsrOverdue,
  nextDsrStatuses,
  normalizeSubjectRef,
} from "./domain";

describe("dsrDueAt", () => {
  it("is 30 days after receipt", () => {
    const received = new Date("2026-10-12T09:30:00Z");
    expect(dsrDueAt(received).toISOString()).toBe("2026-11-11T09:30:00.000Z");
  });
});

describe("DSR transitions", () => {
  const allowed: [DsrStatus, DsrStatus][] = [
    ["received", "in_progress"],
    ["received", "rejected"],
    ["in_progress", "completed"],
    ["in_progress", "rejected"],
  ];

  it("allows exactly received → in_progress → completed and open → rejected", () => {
    for (const from of DSR_STATUSES) {
      for (const to of DSR_STATUSES) {
        const expected = allowed.some(([f, t]) => f === from && t === to);
        expect(canMoveDsr(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
  });

  it("completed and rejected are final", () => {
    expect(nextDsrStatuses("completed")).toEqual([]);
    expect(nextDsrStatuses("rejected")).toEqual([]);
  });
});

describe("deadline", () => {
  const now = new Date("2026-10-12T12:00:00Z");

  it("an open request past its deadline is overdue, a closed one never is", () => {
    const past = new Date("2026-10-11T12:00:00Z");
    expect(isDsrOverdue("received", past, now)).toBe(true);
    expect(isDsrOverdue("in_progress", past, now)).toBe(true);
    expect(isDsrOverdue("completed", past, now)).toBe(false);
    expect(isDsrOverdue("rejected", past, now)).toBe(false);
    expect(isDsrOverdue("received", new Date("2026-10-13T12:00:00Z"), now)).toBe(false);
  });

  it("counts whole days left, rounded up", () => {
    expect(daysUntil(new Date("2026-10-13T11:00:00Z"), now)).toBe(1);
    expect(daysUntil(new Date("2026-11-11T12:00:00Z"), now)).toBe(30);
    expect(daysUntil(new Date("2026-10-10T12:00:00Z"), now)).toBe(-2);
  });
});

describe("normalizeSubjectRef", () => {
  it("trims and lower-cases an e-mail address", () => {
    expect(normalizeSubjectRef("  Jan.Peeters@Example.BE ")).toBe("jan.peeters@example.be");
  });

  it("refuses anything that is not an e-mail address", () => {
    for (const value of ["", "   ", "jan", "jan@", "@example.be", "jan@example", "a b@c.be"]) {
      expect(normalizeSubjectRef(value), value).toBeNull();
    }
    expect(normalizeSubjectRef(`${"a".repeat(250)}@x.be`)).toBeNull();
  });
});
