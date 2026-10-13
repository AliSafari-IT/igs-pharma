import { describe, expect, it } from "vitest";

import { addBrusselsDays, addBrusselsMonths, brusselsInstant, brusselsLocal } from "./brussels";

// Expectations are written from the calendar, not computed with the code under test. Brussels
// switches to summer time on the last Sunday of March (2026: the 29th, 02:00 → 03:00) and back on
// the last Sunday of October (2026: the 25th, 03:00 → 02:00); winter is UTC+1, summer UTC+2.
const iso = (instant: Date) => instant.toISOString();

describe("addBrusselsDays", () => {
  it.each([
    // [reference instant (UTC), days, expected instant (UTC), why]
    ["2026-01-20T12:00:00Z", -30, "2025-12-21T12:00:00Z", "winter to winter: 30 × 24 h"],
    ["2026-11-02T11:00:00Z", -30, "2026-10-03T10:00:00Z", "12:00 CET back to 12:00 CEST"],
    ["2026-04-05T10:00:00Z", -30, "2026-03-06T11:00:00Z", "12:00 CEST back to 12:00 CET"],
    [
      "2026-04-28T00:30:00Z",
      -30,
      "2026-03-29T01:30:00Z",
      "02:30 on 29 Mar does not exist: moves forward to 03:30 CEST",
    ],
    [
      "2026-11-24T01:30:00Z",
      -30,
      "2026-10-25T00:30:00Z",
      "02:30 on 25 Oct happens twice: the earlier (CEST) instant",
    ],
    ["2026-03-01T23:30:00Z", -1, "2026-02-28T23:30:00Z", "one day, no change"],
    ["2026-03-30T10:00:00Z", -1, "2026-03-29T10:00:00Z", "a 23-hour day counts as one day"],
    ["2026-10-26T11:00:00Z", -1, "2026-10-25T11:00:00Z", "a 25-hour day counts as one day"],
    ["2026-03-28T11:00:00Z", 2, "2026-03-30T10:00:00Z", "forward over the March change"],
    ["2026-12-31T22:30:00Z", 1, "2027-01-01T22:30:00Z", "23:30 CET on 31 Dec stays 23:30 on 1 Jan"],
    ["2026-01-20T12:00:00Z", 0, "2026-01-20T12:00:00Z", "zero days"],
  ])("%s %+i days = %s (%s)", (from, days, expected) => {
    expect(iso(addBrusselsDays(new Date(from), days))).toBe(new Date(expected).toISOString());
  });

  it("keeps the milliseconds", () => {
    expect(iso(addBrusselsDays(new Date("2026-01-20T12:00:00.123Z"), -30))).toBe(
      "2025-12-21T12:00:00.123Z",
    );
  });
});

describe("addBrusselsMonths", () => {
  it.each([
    ["2027-01-15T10:00:00+01:00", 1, "2027-02-15T10:00:00+01:00", "same day next month"],
    ["2027-01-31T10:00:00+01:00", 1, "2027-02-28T10:00:00+01:00", "clamps to 28 February"],
    ["2028-01-31T10:00:00+01:00", 1, "2028-02-29T10:00:00+01:00", "clamps to 29 February"],
    ["2027-12-31T10:00:00+01:00", 1, "2028-01-31T10:00:00+01:00", "December rolls into January"],
    ["2027-01-31T10:00:00+01:00", -1, "2026-12-31T10:00:00+01:00", "a month back over a year"],
    ["2027-03-31T10:00:00+02:00", -1, "2027-02-28T10:00:00+01:00", "back, clamped, DST differs"],
    ["2027-02-28T10:00:00+01:00", 1, "2027-03-28T10:00:00+02:00", "across the March change"],
    ["2027-01-15T10:00:00+01:00", 14, "2028-03-15T10:00:00+01:00", "more than a year"],
    ["2027-01-15T10:00:00+01:00", 0, "2027-01-15T10:00:00+01:00", "zero months"],
  ])("%s %+i months = %s (%s)", (from, months, expected) => {
    expect(iso(addBrusselsMonths(new Date(from), months))).toBe(new Date(expected).toISOString());
  });
});

describe("brusselsLocal / brusselsInstant", () => {
  it("round-trip an ordinary wall time", () => {
    const instant = Date.parse("2026-07-01T10:15:30Z"); // 12:15:30 CEST
    expect(brusselsLocal(instant)).toEqual({
      year: 2026,
      month: 7,
      day: 1,
      hour: 12,
      minute: 15,
      second: 30,
    });
    expect(brusselsInstant(brusselsLocal(instant))).toBe(instant);
  });

  it("resolves a skipped wall time forward and a repeated one to the earlier instant", () => {
    const wall = (month: number, day: number) => ({
      year: 2026,
      month,
      day,
      hour: 2,
      minute: 30,
      second: 0,
    });
    expect(new Date(brusselsInstant(wall(3, 29))).toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(new Date(brusselsInstant(wall(10, 25))).toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
});
