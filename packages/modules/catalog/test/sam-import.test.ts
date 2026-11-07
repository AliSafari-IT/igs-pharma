// SAM import (igs-pharma#237) against real Postgres: CNK upsert, draft-only, regulated fields
// never written, manual texts kept, duplicate GTINs counted, idempotent, one audit event per run.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, isDomainError } from "@igs/kernel";
import { type KernelTestHandles, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { loadRbacCatalogue } from "@igs/module-identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createProduct,
  createProductRegulated,
  registerAuditActions,
  setProductStatusRegulated,
} from "../src";
import { SAM_IMPORT_ACTOR, importSamBatch, runSamImport } from "../src/sam";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerAuditActions(registerAuditAction);
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(() => {
  kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date());
});

const NOW = new Date("2026-11-07T10:00:00Z");
const OTC = ["FIXTURE_OTC"];

const staff = (...roles: string[]): Actor => ({
  type: "user",
  id: randomUUID(),
  roles,
  kind: "staff",
  mfaVerified: true,
});
const pharmacist = staff("pharmacist");
const editor = staff("content_editor");

let nextCnk = 9_800_000;
const cnk = () => String(nextCnk++);

let nextGtin = 541_000_000_000;
/** A fresh valid EAN-13 (GS1 check digit) and its 14-digit form. */
function gtin(): { ean: string; stored: string } {
  const body = String(nextGtin++);
  let sum = 0;
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = 4 - w) sum += Number(body[i]) * w;
  const ean = body + String((10 - (sum % 10)) % 10);
  return { ean, stored: ean.padStart(14, "0") };
}

interface Pack {
  cnk: string;
  gtin?: string | undefined;
  nl?: string | undefined;
  fr?: string | undefined;
  de?: string | undefined;
  code?: string | undefined;
  marketed?: boolean | undefined;
}

/** A hand-made AMP export with one AMP per pack (same shape as test/fixtures/sam-amp-small.xml). */
function exportXml(packs: readonly Pack[]): string {
  const amps = packs.map(
    (p, i) => `
  <ns4:Amp code="SAM9${String(i).padStart(5, "0")}-00">
    <ns4:Data from="2020-01-01"><ns4:Status>AUTHORIZED</ns4:Status></ns4:Data>
    <ns4:Ampp ctiExtended="9${i}-01">
      <ns4:Data from="2020-01-01">
        <ns4:Status>AUTHORIZED</ns4:Status>
        ${p.gtin ? `<ns4:Gtin>${p.gtin}</ns4:Gtin>` : ""}
        <ns4:PrescriptionNameFamhp>
          ${p.nl ? `<Nl>${p.nl}</Nl>` : ""}${p.fr ? `<Fr>${p.fr}</Fr>` : ""}${p.de ? `<De>${p.de}</De>` : ""}
        </ns4:PrescriptionNameFamhp>
        <ns4:DeliveryModus code="${p.code ?? "FIXTURE_OTC"}"/>
      </ns4:Data>
      <ns4:Commercialization><ns4:Data from="2020-02-01"${p.marketed === false ? ' to="2021-01-01"' : ""}/></ns4:Commercialization>
      <ns4:Dmpp code="${p.cnk}" codeType="CNK" deliveryEnvironment="P"/>
    </ns4:Ampp>
  </ns4:Amp>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<ns4:ExportActualMedicines xmlns="urn:be:fgov:ehealth:samws:v2:core" xmlns:ns4="urn:be:fgov:ehealth:samws:v2:export">${amps.join("")}
</ns4:ExportActualMedicines>`;
}

async function* chunks(text: string): AsyncGenerator<string> {
  for (let at = 0; at < text.length; at += 256) yield text.slice(at, at + 256);
}
const run = (xml: string, extra: { dryRun?: boolean; batchSize?: number } = {}) =>
  runSamImport(chunks(xml), { otcDeliveryModusCodes: OTC, now: NOW, ...extra });

const pack = (overrides: Partial<Pack> = {}): Pack => {
  const c = overrides.cnk ?? cnk();
  return {
    cnk: c,
    nl: `Product ${c} tabl. 30`,
    fr: `Produit ${c} comp. 30`,
    de: `Produkt ${c} Tabl. 30`,
    ...overrides,
  };
};

const productByCnk = async (code: string) =>
  (
    await iso.sql<
      {
        id: string;
        status: string;
        version: number;
        gtin: string | null;
        product_type: string;
        legal_status: string;
        vat_class: string;
        requires_pharmacist_review: boolean;
        age_min: number | null;
        updated_at: Date;
      }[]
    >`SELECT id, status, version, gtin, product_type, legal_status, vat_class,
             requires_pharmacist_review, age_min, updated_at
        FROM catalog.products WHERE cnk = ${code}`
  )[0];
const contentOf = async (productId: string) =>
  iso.sql<{ locale: string; name: string; source: string; approved_by: string | null }[]>`
    SELECT locale, name, source, approved_by FROM catalog.product_content
     WHERE product_id = ${productId} ORDER BY locale`;
const runEvents = async (runId: string) =>
  iso.sql<{ action: string; actor_id: string; data: Record<string, unknown> }[]>`
    SELECT action, actor_id, data FROM audit.events WHERE entity_id = ${runId} ORDER BY seq`;

describe("SAM import: first run", () => {
  it("creates draft OTC products flagged for pharmacist review, with unapproved sam texts", async () => {
    const g = gtin();
    const a = pack({ gtin: g.ean });
    const b = pack({ de: undefined });
    const rx = pack({ code: "FIXTURE_RX" });
    const gone = pack({ marketed: false });
    const noFr = pack({ fr: undefined });
    const report = await run(exportXml([a, b, rx, gone, noFr]));

    expect(report).toMatchObject({
      outcome: "completed",
      read: 5,
      rows: 2,
      created: 2,
      updated: 0,
      unchanged: 0,
      withdrawn: 1,
      conflicts: 0,
      failed: 0,
      skipped: { prescription: 1, missing_name: 1 },
      deliveryModus: { FIXTURE_OTC: 4, FIXTURE_RX: 1 },
    });

    const product = await productByCnk(a.cnk);
    expect(product).toMatchObject({
      status: "draft",
      version: 1,
      gtin: g.stored,
      product_type: "otc_medicine",
      legal_status: "otc",
      vat_class: "BE_6",
      requires_pharmacist_review: true,
      age_min: null,
    });
    expect(await contentOf(product?.id as string)).toEqual([
      { locale: "de", name: a.de, source: "sam", approved_by: null },
      { locale: "fr", name: a.fr, source: "sam", approved_by: null },
      { locale: "nl", name: a.nl, source: "sam", approved_by: null },
    ]);
    expect(
      (await contentOf((await productByCnk(b.cnk))?.id as string)).map((c) => c.locale),
    ).toEqual(["fr", "nl"]);
    // prescription, withdrawn and half-named packs are never written, not even partly
    for (const p of [rx, gone, noFr]) expect(await productByCnk(p.cnk)).toBeUndefined();
  });

  it("writes exactly one audit event per run, counts only", async () => {
    const report = await run(exportXml([pack(), pack(), pack({ code: "FIXTURE_RX" })]));
    const events = await runEvents(report.runId);
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe("catalog.sam_import.completed");
    expect(events[0]?.actor_id).toBe(SAM_IMPORT_ACTOR.id);
    expect(events[0]?.data).toMatchObject({
      outcome: "completed",
      read: 3,
      created: 2,
      skipped_prescription: 1,
    });
    // no CNK and no text in the event
    expect(JSON.stringify(events[0]?.data)).not.toMatch(/Product|Produit|98\d{5}/);
  });

  it("imports in batches of the given size", async () => {
    const packs = Array.from({ length: 7 }, () => pack());
    const report = await run(exportXml(packs), { batchSize: 3 });
    expect(report.created).toBe(7);
  });

  it("retries a failed batch row by row: one bad row is counted, the others are imported", async () => {
    const bad = pack();
    await iso.sql.unsafe(`
      CREATE FUNCTION catalog.test_refuse_cnk() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.cnk = '${bad.cnk}' THEN RAISE EXCEPTION 'refused by test'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_refuse_cnk BEFORE INSERT ON catalog.products
        FOR EACH ROW EXECUTE FUNCTION catalog.test_refuse_cnk();`);
    try {
      const good = [pack(), pack()];
      const report = await run(exportXml([good[0] as Pack, bad, good[1] as Pack]));
      expect(report).toMatchObject({ rows: 3, created: 2, failed: 1 });
      expect(await productByCnk(bad.cnk)).toBeUndefined();
      for (const p of good) expect(await productByCnk(p.cnk)).toBeDefined();
    } finally {
      await iso.sql.unsafe(`
        DROP TRIGGER test_refuse_cnk ON catalog.products;
        DROP FUNCTION catalog.test_refuse_cnk();`);
    }
  });

  it("a broken file still ends with one audit event (aborted) and the error", async () => {
    const xml = exportXml([pack(), pack()]);
    const broken = `${xml.slice(0, xml.lastIndexOf("<ns4:Amp "))}<ns4:Amp><oops></ns4:Amp>`;
    const before = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit.events WHERE action = 'catalog.sam_import.completed'`;
    await expect(run(broken)).rejects.toThrow();
    const rows = await iso.sql<{ data: Record<string, unknown> }[]>`
      SELECT data FROM audit.events WHERE action = 'catalog.sam_import.completed' ORDER BY seq`;
    expect(rows).toHaveLength((before[0]?.n ?? 0) + 1);
    expect(rows.at(-1)?.data).toMatchObject({ outcome: "aborted" });
  });

  it("writes nothing in a dry run", async () => {
    const p = pack();
    const report = await run(exportXml([p]), { dryRun: true });
    expect(report).toMatchObject({ dryRun: true, read: 1, rows: 1, created: 0 });
    expect(await productByCnk(p.cnk)).toBeUndefined();
    expect(await runEvents(report.runId)).toEqual([]);
  });
});

describe("SAM import: idempotent", () => {
  it("a second run of the same file changes nothing", async () => {
    const xml = exportXml([pack({ gtin: gtin().ean }), pack(), pack({ marketed: false })]);
    const first = await run(xml);
    expect(first.created).toBe(2);
    const before = await iso.sql`
      SELECT p.id, p.version, p.updated_at, p.gtin, c.locale, c.name, c.updated_at AS content_at
        FROM catalog.products p JOIN catalog.product_content c ON c.product_id = p.id
       ORDER BY p.id, c.locale`;
    const second = await run(xml);
    expect(second).toMatchObject({ created: 0, updated: 0, unchanged: 2, withdrawn: 1 });
    const after = await iso.sql`
      SELECT p.id, p.version, p.updated_at, p.gtin, c.locale, c.name, c.updated_at AS content_at
        FROM catalog.products p JOIN catalog.product_content c ON c.product_id = p.id
       ORDER BY p.id, c.locale`;
    expect(after).toEqual(before);
  });

  it("a changed SAM name updates the sam text, clears nothing else and bumps the version once", async () => {
    const p = pack();
    await run(exportXml([p]));
    const report = await run(exportXml([{ ...p, nl: `${p.nl} (nieuw)` }]));
    expect(report).toMatchObject({ updated: 1, created: 0 });
    const product = await productByCnk(p.cnk);
    expect(product?.version).toBe(2);
    const nl = (await contentOf(product?.id as string)).find((c) => c.locale === "nl");
    expect(nl).toMatchObject({ name: `${p.nl} (nieuw)`, source: "sam" });
  });
});

describe("SAM import: existing products", () => {
  it("never overwrites a manual text; only adds a missing locale", async () => {
    const code = cnk();
    const { productId } = await createProductRegulated(
      {
        cnk: code,
        productType: "otc_medicine",
        legalStatus: "otc",
        vatClass: "BE_6",
        content: [
          { locale: "nl", name: "Handmatige naam" },
          { locale: "fr", name: "Nom manuel" },
        ],
      },
      pharmacist,
    );
    const report = await run(exportXml([pack({ cnk: code })]));
    expect(report).toMatchObject({ updated: 1, textsKept: 2, conflicts: 0 });
    expect(await contentOf(productId)).toEqual([
      { locale: "de", name: `Produkt ${code} Tabl. 30`, source: "sam", approved_by: null },
      { locale: "fr", name: "Nom manuel", source: "manual", approved_by: null },
      { locale: "nl", name: "Handmatige naam", source: "manual", approved_by: null },
    ]);
    // and a second run leaves it alone
    expect(await run(exportXml([pack({ cnk: code })]))).toMatchObject({
      unchanged: 1,
      textsKept: 2,
    });
  });

  it("reports a regulated-field difference as a conflict and writes nothing", async () => {
    const code = cnk();
    const { productId, version } = await createProduct(
      {
        cnk: code,
        productType: "general",
        legalStatus: "general_sale",
        vatClass: "BE_21",
        content: [
          { locale: "nl", name: "Algemeen" },
          { locale: "fr", name: "Général" },
        ],
      },
      editor,
    );
    const g = gtin();
    const report = await run(exportXml([pack({ cnk: code, gtin: g.ean })]));
    expect(report).toMatchObject({ conflicts: 1, updated: 0, created: 0 });
    const product = await productByCnk(code);
    expect(product).toMatchObject({
      id: productId,
      version,
      gtin: null,
      product_type: "general",
      legal_status: "general_sale",
      vat_class: "BE_21",
      requires_pharmacist_review: false,
    });
    expect((await contentOf(productId)).map((c) => c.source)).toEqual(["manual", "manual"]);
  });

  it("never activates, and never deactivates an active product", async () => {
    const code = cnk();
    const { productId } = await createProductRegulated(
      {
        cnk: code,
        productType: "otc_medicine",
        legalStatus: "otc",
        vatClass: "BE_6",
        content: [
          { locale: "nl", name: "Actief" },
          { locale: "fr", name: "Actif" },
        ],
        approveContent: true,
      },
      pharmacist,
    );
    await setProductStatusRegulated({ productId, status: "active" }, pharmacist);
    const fresh = pack();
    await run(exportXml([pack({ cnk: code }), fresh]));
    expect((await productByCnk(code))?.status).toBe("active");
    expect((await productByCnk(fresh.cnk))?.status).toBe("draft");
    const statuses = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM catalog.products p
       WHERE p.status = 'active'
         AND EXISTS (SELECT 1 FROM catalog.product_content c
                      WHERE c.product_id = p.id AND c.source = 'sam')
         AND NOT EXISTS (SELECT 1 FROM catalog.product_content c
                          WHERE c.product_id = p.id AND c.source <> 'sam')`;
    expect(statuses[0]?.n).toBe(0); // nothing became active on SAM text alone
  });

  it("a withdrawn pack is counted and its existing product left untouched", async () => {
    const p = pack();
    await run(exportXml([p]));
    const before = await productByCnk(p.cnk);
    const report = await run(exportXml([{ ...p, marketed: false, nl: "anders" }]));
    expect(report).toMatchObject({ withdrawn: 1, updated: 0 });
    expect(await productByCnk(p.cnk)).toEqual(before);
  });
});

describe("SAM import: GTIN", () => {
  it("skips a GTIN another product already has, without an error", async () => {
    const g = gtin();
    const owner = pack({ gtin: g.ean });
    await run(exportXml([owner]));
    const other = pack({ gtin: g.ean });
    const twin = pack({ gtin: g.ean }); // the same GTIN twice in one file
    const report = await run(exportXml([other, twin]));
    expect(report).toMatchObject({ created: 2, gtinTaken: 2, failed: 0 });
    expect((await productByCnk(other.cnk))?.gtin).toBeNull();
    expect((await productByCnk(twin.cnk))?.gtin).toBeNull();
    expect((await productByCnk(owner.cnk))?.gtin).toBe(g.stored);
  });

  it("counts an invalid GTIN and imports the pack without it", async () => {
    const p = pack({ gtin: "5400000000011" }); // wrong check digit
    const report = await run(exportXml([p]));
    expect(report).toMatchObject({ created: 1, gtinInvalid: 1 });
    expect((await productByCnk(p.cnk))?.gtin).toBeNull();
  });

  it("fills an empty GTIN on an existing product but keeps a different stored one", async () => {
    const p = pack();
    await run(exportXml([p]));
    const g = gtin();
    expect(await run(exportXml([{ ...p, gtin: g.ean }]))).toMatchObject({ updated: 1 });
    expect((await productByCnk(p.cnk))?.gtin).toBe(g.stored);
    const report = await run(exportXml([{ ...p, gtin: gtin().ean }]));
    expect(report).toMatchObject({ gtinKept: 1, unchanged: 1 });
    expect((await productByCnk(p.cnk))?.gtin).toBe(g.stored);
  });
});

describe("SAM import: the commands", () => {
  const row = { cnk: "9899999", gtin: null, gtinInvalid: false, names: { nl: "x", fr: "y" } };

  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      if (isDomainError(error)) return error.code;
      throw error;
    }
    return "ok";
  };

  it("refuses a user actor, even a pharmacist (the permission is system-only)", async () => {
    expect(await codeOf(importSamBatch({ rows: [row] }, pharmacist))).toBe("kernel.forbidden");
  });

  it("refuses a user actor that would hold the permission (internal: system actors only)", async () => {
    const user: Actor = { ...pharmacist, roles: ["system_catalog_import"] };
    expect(await codeOf(importSamBatch({ rows: [row] }, user))).toBe("kernel.internal_command");
  });

  it("refuses a system actor without catalog.products.import", async () => {
    const seed: Actor = { type: "system", id: "seed-catalog", roles: ["system_seed"] };
    expect(await codeOf(importSamBatch({ rows: [row] }, seed))).toBe("kernel.forbidden");
  });

  it("the fixture file imports two packs", async () => {
    // the hand-made fixture uses CNKs 99000xx, which no other test here uses
    const xml = readFileSync(new URL("./fixtures/sam-amp-small.xml", import.meta.url), "utf8");
    const report = await run(xml);
    expect(report).toMatchObject({
      read: 7,
      created: 2,
      withdrawn: 1,
      gtinInvalid: 1,
      skipped: { prescription: 1, missing_name: 1, invalid_cnk: 1, no_public_cnk: 1 },
    });
  });
});
