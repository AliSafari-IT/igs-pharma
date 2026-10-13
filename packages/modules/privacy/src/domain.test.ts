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

describe("dsrDueAt (one calendar month, Europe/Brussels)", () => {
  // inputs and outputs are instants written with their Brussels offset: +01:00 winter, +02:00 summer
  const cases: [string, string, string][] = [
    ["same day next month", "2027-01-15T10:00:00+01:00", "2027-02-15T10:00:00+01:00"],
    ["clamps to 28 February", "2027-01-31T10:00:00+01:00", "2027-02-28T10:00:00+01:00"],
    ["clamps to 29 February (leap year)", "2028-01-31T10:00:00+01:00", "2028-02-29T10:00:00+01:00"],
    ["1 Feb is due 1 Mar, not 3 Mar", "2027-02-01T10:00:00+01:00", "2027-03-01T10:00:00+01:00"],
    ["30 March is due 30 April", "2027-03-30T10:00:00+02:00", "2027-04-30T10:00:00+02:00"],
    ["31 March is due 30 April", "2027-03-31T10:00:00+02:00", "2027-04-30T10:00:00+02:00"],
    ["December rolls into the next year", "2027-12-31T10:00:00+01:00", "2028-01-31T10:00:00+01:00"],
    ["31 August is due 30 September", "2027-08-31T10:00:00+02:00", "2027-09-30T10:00:00+02:00"],
    [
      "across the March change (28 Mar 2027) the local time stays 10:00",
      "2027-02-28T10:00:00+01:00",
      "2027-03-28T10:00:00+02:00",
    ],
    [
      "a month that ends before the March change (14 Feb → 14 Mar) keeps 02:30; no DST in between",
      "2027-02-14T02:30:00+01:00",
      "2027-03-14T02:30:00+01:00",
    ],
    [
      "a month that ends before the October change (30 Sep → 30 Oct) keeps 10:00; no DST in between",
      "2027-09-30T10:00:00+02:00",
      "2027-10-30T10:00:00+02:00",
    ],
    [
      "a request from before the October change is due after it, at the same local time",
      "2027-10-01T10:00:00+02:00",
      "2027-11-01T10:00:00+01:00",
    ],
    [
      "a request on the day of the October change",
      "2027-10-31T10:00:00+01:00",
      "2027-11-30T10:00:00+01:00",
    ],
    [
      "a request in the March change month, due after it",
      "2027-03-28T10:00:00+02:00",
      "2027-04-28T10:00:00+02:00",
    ],
    [
      "just before midnight stays on the Brussels date",
      "2027-01-31T23:30:00+01:00",
      "2027-02-28T23:30:00+01:00",
    ],
  ];
  for (const [name, received, due] of cases) {
    it(name, () => {
      expect(dsrDueAt(new Date(received)).toISOString()).toBe(new Date(due).toISOString());
    });
  }

  it("uses the Brussels calendar date, not the UTC one", () => {
    // 31 Jan 23:30 UTC is already 1 Feb 00:30 in Brussels: due 1 Mar 00:30 Brussels (28 Feb 23:30 UTC),
    // not the 28 Feb that a UTC calendar would give
    expect(dsrDueAt(new Date("2027-01-31T23:30:00Z")).toISOString()).toBe(
      "2027-02-28T23:30:00.000Z",
    );
  });

  it("takes the EARLIER instant when the due wall time happens twice (October)", () => {
    // the last Sunday of October is the 25th in 2026 and the 29th in 2028: 02:30 happens at 00:30Z
    // (CEST) and again at 01:30Z (CET); the deadline is the first
    expect(dsrDueAt(new Date("2026-09-25T02:30:00+02:00")).toISOString()).toBe(
      "2026-10-25T00:30:00.000Z",
    );
    expect(dsrDueAt(new Date("2028-09-29T02:30:00+02:00")).toISOString()).toBe(
      "2028-10-29T00:30:00.000Z",
    );
    // just outside the doubled hour nothing is ambiguous
    expect(dsrDueAt(new Date("2026-09-25T03:30:00+02:00")).toISOString()).toBe(
      "2026-10-25T02:30:00.000Z", // 03:30 CET
    );
    expect(dsrDueAt(new Date("2026-09-25T01:59:00+02:00")).toISOString()).toBe(
      "2026-10-24T23:59:00.000Z", // 01:59 CEST
    );
  });

  it("keeps seconds and milliseconds", () => {
    expect(dsrDueAt(new Date("2026-10-12T09:30:15.250Z")).toISOString()).toBe(
      "2026-11-12T10:30:15.250Z",
    );
  });

  it("maps a time that does not exist after the change to the hour after it", () => {
    // 28 Feb 02:30 +01:00 is due 28 Mar 02:30, which Brussels skips (02:00 → 03:00): 03:30 +02:00
    expect(dsrDueAt(new Date("2027-02-28T02:30:00+01:00")).toISOString()).toBe(
      new Date("2027-03-28T03:30:00+02:00").toISOString(),
    );
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
