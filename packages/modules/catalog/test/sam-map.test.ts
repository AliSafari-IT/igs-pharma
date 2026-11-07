// SAM import (igs-pharma#237), unit level: the streaming parser and the pure AMPP mapping, over a
// HAND-MADE fixture (test/fixtures/sam-amp-small.xml), no database.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  SAM_IMPORT_JOBS,
  SAM_SKIP_REASONS,
  type SamAmp,
  type SamOutcome,
  brusselsToday,
  mapAmp,
  parseSamAmps,
  registerSamImportJob,
} from "../src/sam";
import { SKIPPED_KEYS, samRunAudit } from "../src/sam/report";

const XML = readFileSync(new URL("./fixtures/sam-amp-small.xml", import.meta.url), "utf8");
const OTC = new Set(["FIXTURE_OTC"]);
const TODAY = "2026-11-07";

async function* inPieces(text: string, size: number): AsyncGenerator<string> {
  for (let at = 0; at < text.length; at += size) yield text.slice(at, at + size);
}
async function* bytesInPieces(text: string, size: number): AsyncGenerator<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
}
async function collect(chunks: AsyncIterable<string | Uint8Array>): Promise<SamAmp[]> {
  const out: SamAmp[] = [];
  for await (const amp of parseSamAmps(chunks)) out.push(amp);
  return out;
}
async function outcomes(otc: ReadonlySet<string> = OTC, today = TODAY): Promise<SamOutcome[]> {
  const amps = await collect(inPieces(XML, 64));
  return amps.flatMap((amp) => mapAmp(amp, { today, otcDeliveryModusCodes: otc }));
}

describe("parseSamAmps", () => {
  it("yields one tree per <Amp>, whatever the chunk size, with prefixes stripped", async () => {
    for (const size of [1, 7, 64, 100_000]) {
      const amps = await collect(inPieces(XML, size));
      expect(amps.map((a) => a.attrs["code"])).toEqual(["SAM900001-00", "SAM900002-00"]);
      expect(amps[0]?.children.filter((c) => c.name === "Ampp")).toHaveLength(4);
    }
  });

  it("decodes UTF-8 split in the middle of a character", async () => {
    // 3-byte pieces cut "é" (2 bytes) in half somewhere in the file
    const amps = await collect(bytesInPieces(XML, 3));
    const outs = amps.flatMap((amp) => mapAmp(amp, { today: TODAY, otcDeliveryModusCodes: OTC }));
    const first = outs.find((o) => o.kind === "row");
    expect(first?.kind === "row" && first.row.names.fr).toBe("Fixtamol 500 mg comp. 30");
    const amp = amps[0];
    expect(JSON.stringify(amp)).toContain("comprimés");
  });

  it("throws on malformed XML instead of yielding half a record", async () => {
    const broken = XML.replace("</ns4:Ampp>", "</ns4:Amppp>");
    await expect(collect(inPieces(broken, 50))).rejects.toThrow();
  });
});

describe("mapAmp", () => {
  it("maps the fixture: one row per importable pack, a reason for every other", async () => {
    const outs = await outcomes();
    expect(outs).toHaveLength(7);
    const [otc, rx, badGtin, withdrawn, noFr, badCnk, hospital] = outs;
    expect(otc).toEqual({
      kind: "row",
      deliveryModus: "FIXTURE_OTC",
      row: {
        cnk: "9900001",
        gtin: "05400000000010",
        gtinInvalid: false,
        // pack names in nl/fr; German falls back to the AMP name
        names: {
          nl: "Fixtamol 500 mg tabl. 30",
          fr: "Fixtamol 500 mg comp. 30",
          de: "Fixtamol 500 mg Tabletten",
        },
      },
    });
    expect(rx).toEqual({ kind: "skip", reason: "prescription", deliveryModus: "FIXTURE_RX" });
    // the expired 2019 period said FIXTURE_RX; the current one is OTC
    expect(badGtin).toMatchObject({
      kind: "row",
      row: { cnk: "9900003", gtin: null, gtinInvalid: true },
    });
    expect(withdrawn).toEqual({ kind: "withdrawn", cnk: "9900004", deliveryModus: "FIXTURE_OTC" });
    expect(noFr).toEqual({ kind: "skip", reason: "missing_name", deliveryModus: "FIXTURE_OTC" });
    expect(badCnk).toEqual({ kind: "skip", reason: "invalid_cnk" });
    expect(hospital).toEqual({ kind: "skip", reason: "no_public_cnk" });
  });

  it("fails closed: without configured OTC codes every pack counts as prescription", async () => {
    const outs = await outcomes(new Set());
    expect(outs.filter((o) => o.kind === "row" || o.kind === "withdrawn")).toEqual([]);
    expect(outs.filter((o) => o.kind === "skip" && o.reason === "prescription")).toHaveLength(5);
  });

  it("uses the Data period in force on the given day", async () => {
    // in 2019 pack 9900003 was on prescription, and nothing else had current data
    const outs = await outcomes(OTC, "2019-06-01");
    expect(outs[2]).toEqual({ kind: "skip", reason: "prescription", deliveryModus: "FIXTURE_RX" });
    expect(outs[0]).toEqual({ kind: "skip", reason: "no_current_data" });
  });

  it("treats a pack before its commercialisation started as withdrawn", async () => {
    const outs = await outcomes(OTC, "2020-01-15");
    expect(outs[0]).toMatchObject({ kind: "withdrawn", cnk: "9900001" });
  });

  it("treats a pack whose status is not AUTHORIZED as withdrawn", async () => {
    const suspended = XML.replace(
      "<ns4:Status>AUTHORIZED</ns4:Status>\n        <ns4:Gtin>5400000000010",
      "<ns4:Status>SUSPENDED</ns4:Status>\n        <ns4:Gtin>5400000000010",
    );
    const amps = await collect(inPieces(suspended, 1000));
    const [first] = mapAmp(amps[0] as SamAmp, { today: TODAY, otcDeliveryModusCodes: OTC });
    expect(first).toMatchObject({ kind: "withdrawn", cnk: "9900001" });
  });
});

describe("brusselsToday", () => {
  it("is the Brussels calendar date, not the UTC one", () => {
    expect(brusselsToday(new Date("2026-11-06T23:30:00Z"))).toBe("2026-11-07"); // 00:30 CET
    expect(brusselsToday(new Date("2026-07-06T22:30:00Z"))).toBe("2026-07-07"); // 00:30 CEST
    expect(brusselsToday(new Date("2026-11-07T12:00:00Z"))).toBe("2026-11-07");
  });
});

describe("run audit schema", () => {
  it("has one skipped_<reason> count per skip reason", () => {
    const keys = Object.keys(samRunAudit.shape).filter((k) => k.startsWith("skipped_"));
    expect(keys.sort()).toEqual([...SKIPPED_KEYS].sort());
    expect(SKIPPED_KEYS).toHaveLength(SAM_SKIP_REASONS.length);
  });
});

describe("SAM import job", () => {
  const fakeBoss = () => {
    const calls: string[] = [];
    return {
      calls,
      boss: {
        getQueue: async () => ({}),
        schedule: async (name: string, cron: string, _d?: object, o?: { tz?: string }) => {
          calls.push(`schedule ${name} ${cron} ${o?.tz}`);
        },
        unschedule: async (name: string) => {
          calls.push(`unschedule ${name}`);
        },
        work: async (name: string) => {
          calls.push(`work ${name}`);
        },
      },
    };
  };
  const runtime = { logger: { warn: () => {}, info: () => {} } } as never;

  it("runs weekly, never in the 02:xx Brussels hour", () => {
    const [minute, hour, , , weekday] = SAM_IMPORT_JOBS.run.cron.split(" ");
    expect(SAM_IMPORT_JOBS.timezone).toBe("Europe/Brussels");
    expect(Number(hour)).not.toBe(2);
    expect(Number(minute)).toBeGreaterThanOrEqual(0);
    expect(weekday).toMatch(/^[0-6]$/);
  });

  it("schedules the run when an export is configured", async () => {
    const { boss, calls } = fakeBoss();
    const openExport = async () => ({ chunks: inPieces("", 1), close: async () => {} });
    await registerSamImportJob(boss, { openExport, otcDeliveryModusCodes: [] }, runtime);
    expect(calls).toEqual([
      "work catalog.sam_import.run.failed",
      "schedule catalog.sam_import.run 41 5 * * 1 Europe/Brussels",
      "work catalog.sam_import.run",
    ]);
  });

  it("schedules nothing (and removes an old schedule) without an export URL", async () => {
    const { boss, calls } = fakeBoss();
    await registerSamImportJob(boss, { openExport: null, otcDeliveryModusCodes: [] }, runtime);
    expect(calls).toEqual([
      "work catalog.sam_import.run.failed",
      "unschedule catalog.sam_import.run",
    ]);
  });
});
