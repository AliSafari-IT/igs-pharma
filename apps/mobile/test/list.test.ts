import { describe, expect, it } from "vitest";
import type { ListItem } from "../src/api/types";
import {
  MAX_SAVED,
  addSaved,
  parseSaved,
  refreshSaved,
  removeSaved,
  toSaved,
} from "../src/list/list";

const item = (cnk: string, amountCents = 995): ListItem => ({
  id: "0192f0c2-0000-7000-8000-000000000000",
  cnk,
  name: `Product ${cnk}`,
  brandName: null,
  shortDescription: null,
  contentLocale: "nl",
  price: { amountCents, vatClass: "standard", vatRateBp: 600 },
  status: "available",
  isMedicine: false,
  topCategory: null,
});
const now = new Date("2026-10-24T12:00:00Z");
const saved = (cnk: string, cents?: number) => toSaved(item(cnk, cents), "nl", now);

describe("My list", () => {
  it("adds at the top without duplicates, and caps the list", () => {
    let list = addSaved([], saved("1000001"));
    list = addSaved(list, saved("1000002"));
    list = addSaved(list, saved("1000001", 500));
    expect(list.map((p) => p.cnk)).toEqual(["1000001", "1000002"]);
    expect(list[0]?.price.amountCents).toBe(500);
    for (let i = 0; i < MAX_SAVED + 5; i++) list = addSaved(list, saved(String(2000000 + i)));
    expect(list).toHaveLength(MAX_SAVED);
  });

  it("refreshes only products already on the list, and removes", () => {
    const list = [saved("1000001")];
    expect(refreshSaved(list, saved("1000009"))).toEqual(list);
    expect(refreshSaved(list, saved("1000001", 1)).at(0)?.price.amountCents).toBe(1);
    expect(removeSaved(list, "1000001")).toEqual([]);
  });

  it("reads back only well-formed entries from storage", () => {
    const good = saved("1000001");
    expect(parseSaved(JSON.stringify([good, { cnk: "x" }, null, 3]))).toEqual([good]);
    expect(parseSaved("not json")).toEqual([]);
    expect(parseSaved(null)).toEqual([]);
    expect(parseSaved('{"cnk":"1000001"}')).toEqual([]);
    // a status or price the screens cannot show is dropped, not rendered half
    expect(parseSaved(JSON.stringify([{ ...good, status: "soon" }]))).toEqual([]);
    expect(
      parseSaved(JSON.stringify([{ ...good, price: { amountCents: 995, vatClass: "standard" } }])),
    ).toEqual([]);
  });
});
