// Opening the SAM export (igs-pharma#237): the ZIP check, the AMP entry lookup, the capped
// download and the temp-folder cleanup. ZIPs are built here (stored entries), never real exports.
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";

import { parseSamAmps } from "@igs/module-catalog";
import { describe, expect, it } from "vitest";

import { assertZip, openAmpEntry, parseSamImportArgs, samExportOpener } from "../src/sam-export";

const AMP_XML = readFileSync(
  new URL("../../../packages/modules/catalog/test/fixtures/sam-amp-small.xml", import.meta.url),
);

/** A minimal ZIP with stored (uncompressed) entries. */
function zip(entries: Record<string, Buffer | string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const fileName = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, fileName, data);
    centrals.push(central, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

async function tempFile(name: string, content: Buffer | string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "sam-test-"));
  const file = path.join(dir, name);
  await writeFile(file, content);
  return file;
}

async function amps(chunks: AsyncIterable<string | Uint8Array>): Promise<string[]> {
  const codes: string[] = [];
  for await (const amp of parseSamAmps(chunks)) codes.push(amp.attrs["code"] ?? "");
  return codes;
}

const errorCode = async (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: { code?: string }) => error.code ?? "error",
  );

describe("assertZip", () => {
  it("refuses a file that is not a ZIP (an HTML error page, say)", async () => {
    const file = await tempFile("export.zip", "<html>Service unavailable</html>");
    expect(await errorCode(assertZip(file))).toBe("sam.not_a_zip");
  });

  it("accepts a ZIP", async () => {
    const file = await tempFile("export.zip", zip({ "AMP-1.xml": "<x/>" }));
    expect(await errorCode(assertZip(file))).toBe("ok");
  });
});

describe("openAmpEntry", () => {
  it("streams the AMP-<n>.xml entry and nothing else", async () => {
    const file = await tempFile(
      "export.zip",
      zip({
        "VMP-1730000000000.xml": "<ExportVirtualMedicines/>",
        "AMP-1730000000000.xml": AMP_XML,
        "REF-1730000000000.xml": "<ExportReferences/>",
      }),
    );
    const entry = await openAmpEntry(file);
    expect(entry.name).toBe("AMP-1730000000000.xml");
    expect(await amps(entry.stream)).toEqual(["SAM900001-00", "SAM900002-00"]);
    entry.close();
  });

  it("refuses an export without an AMP file, or with two", async () => {
    const none = await tempFile("a.zip", zip({ "VMP-1.xml": "<x/>" }));
    expect(await errorCode(openAmpEntry(none))).toBe("sam.amp_entry_missing");
    const two = await tempFile("b.zip", zip({ "AMP-1.xml": "<x/>", "AMP-2.xml": "<y/>" }));
    expect(await errorCode(openAmpEntry(two))).toBe("sam.amp_entry_ambiguous");
  });
});

describe("samExportOpener", () => {
  const zipBytes = zip({ "AMP-1730000000000.xml": AMP_XML });
  const respond =
    (body: Buffer | string, status = 200): typeof fetch =>
    async () =>
      new Response(body, { status });

  it("is null without a file or a URL (the job is then not scheduled)", () => {
    expect(samExportOpener({ maxBytes: 1_000 })).toBeNull();
  });

  it("downloads to a temp folder, streams the AMP entry, and deletes the folder on close", async () => {
    const before = new Set((await readdir(tmpdir())).filter((n) => n.startsWith("igs-sam-")));
    const open = samExportOpener({
      url: "https://sam.example.test/export.zip",
      maxBytes: 10_000_000,
      fetchImpl: respond(zipBytes),
    });
    const source = await (open as NonNullable<typeof open>)();
    const created = (await readdir(tmpdir())).filter(
      (n) => n.startsWith("igs-sam-") && !before.has(n),
    );
    expect(created).toHaveLength(1);
    expect(await amps(source.chunks)).toEqual(["SAM900001-00", "SAM900002-00"]);
    await source.close();
    expect(existsSync(path.join(tmpdir(), created[0] as string))).toBe(false);
  });

  it("refuses an export over the size cap, a failed download and a non-ZIP answer", async () => {
    const samDirs = async () => (await readdir(tmpdir())).filter((n) => n.startsWith("igs-sam-"));
    const before = (await samDirs()).length;
    const big = samExportOpener({
      url: "https://sam.example.test/export.zip",
      maxBytes: 100,
      fetchImpl: respond(zipBytes),
    });
    expect(await errorCode((big as NonNullable<typeof big>)())).toBe("sam.export_too_large");
    const down = samExportOpener({
      url: "https://sam.example.test/export.zip",
      maxBytes: 10_000_000,
      fetchImpl: respond("unavailable", 503),
    });
    expect(await errorCode((down as NonNullable<typeof down>)())).toBe("sam.download_failed_503");
    const html = samExportOpener({
      url: "https://sam.example.test/export.zip",
      maxBytes: 10_000_000,
      fetchImpl: respond("<html>login</html>"),
    });
    expect(await errorCode((html as NonNullable<typeof html>)())).toBe("sam.not_a_zip");
    // the refused runs leave no temp folder behind
    expect((await samDirs()).length).toBe(before);
  });

  it("opens a local file for the manual run and leaves it in place", async () => {
    const file = await tempFile("export.zip", zipBytes);
    const open = samExportOpener({ file, maxBytes: 1 });
    const source = await (open as NonNullable<typeof open>)();
    expect(await amps(source.chunks)).toHaveLength(2);
    await source.close();
    expect(existsSync(file)).toBe(true);
  });
});

describe("parseSamImportArgs", () => {
  it("reads --file and --dry-run and refuses anything else", () => {
    expect(parseSamImportArgs([])).toEqual({ dryRun: false });
    expect(parseSamImportArgs(["--dry-run", "--file", "x.zip"])).toEqual({
      file: "x.zip",
      dryRun: true,
    });
    expect(() => parseSamImportArgs(["--url", "https://x"])).toThrow(/Unknown argument/);
  });
});
