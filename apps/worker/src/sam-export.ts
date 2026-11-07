/**
 * Opening the SAM v2 export for the import (igs-pharma#237). This is the import's only I/O, and it
 * runs in the worker, before and outside any command (D-019):
 *
 * 1. download `SAM_EXPORT_URL` to a fresh temp folder (streamed, capped at `SAM_EXPORT_MAX_BYTES`),
 *    or take a local file for the manual first run;
 * 2. check the ZIP signature (`PK\x03\x04`) before opening it;
 * 3. stream the single `AMP-<n>.xml` entry out of the ZIP (yauzl; ZIP64 is fine), never extracting
 *    the rest;
 * 4. delete the temp folder when the import is done (`close`).
 *
 * The URL is a server setting and may one day carry a token, so it is never logged.
 */
import { createWriteStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { SamExportStream } from "@igs/module-catalog";
import yauzl from "yauzl";

/** A local file header starts every ZIP (an empty archive starts with the end record instead). */
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** The actual-medicines file of the export (cookbook §3): `AMP-<generation ms>.xml`. */
export const AMP_ENTRY = /^(?:.*\/)?AMP-\d+\.xml$/i;

export class SamExportError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SamExportError";
  }
}

/** Throws `sam.not_a_zip` unless `file` starts with the ZIP local-file signature. */
export async function assertZip(file: string): Promise<void> {
  const handle = await open(file, "r");
  try {
    const head = Buffer.alloc(4);
    const { bytesRead } = await handle.read(head, 0, 4, 0);
    if (bytesRead < 4 || !head.equals(ZIP_SIGNATURE)) throw new SamExportError("sam.not_a_zip");
  } finally {
    await handle.close();
  }
}

/** The whole download (headers and body) must finish within this; then it is aborted. */
export const SAM_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
/** Redirects followed at most, and only on the configured host over https. */
const MAX_REDIRECTS = 3;

/**
 * Streams `url` into `file`. Refuses a non-2xx answer, anything over `maxBytes`, a download slower
 * than `timeoutMs`, and a redirect to another host or away from https (`sam.redirect_refused`):
 * the address is fixed by the server setting and never chosen by the remote side.
 */
export async function downloadTo(
  url: string,
  file: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = SAM_DOWNLOAD_TIMEOUT_MS,
): Promise<number> {
  const signal = AbortSignal.timeout(timeoutMs);
  const host = new URL(url).host;
  let target = url;
  let response: Response;
  for (let hop = 0; ; hop++) {
    try {
      response = await fetchImpl(target, { redirect: "manual", signal });
    } catch (error) {
      if (signal.aborted) throw new SamExportError("sam.download_timeout");
      throw error;
    }
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    const next = location ? new URL(location, target) : null;
    if (!next || next.protocol !== "https:" || next.host !== host || hop >= MAX_REDIRECTS) {
      throw new SamExportError("sam.redirect_refused");
    }
    target = next.toString();
  }
  if (!response.ok || response.body === null) {
    throw new SamExportError(`sam.download_failed_${response.status}`);
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new SamExportError("sam.export_too_large");
  let bytes = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      if (bytes > maxBytes) done(new SamExportError("sam.export_too_large"));
      else done(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
      cap,
      createWriteStream(file, { flags: "wx", mode: 0o600 }),
      { signal },
    );
  } catch (error) {
    if (signal.aborted) throw new SamExportError("sam.download_timeout");
    throw error;
  }
  return bytes;
}

const openZip = (file: string) =>
  new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (error, zip) =>
      error || !zip ? reject(error ?? new SamExportError("sam.zip_unreadable")) : resolve(zip),
    ),
  );

/** Every entry of the archive (names and offsets only; nothing is decompressed). */
function listEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    zip.on("entry", (entry: yauzl.Entry) => {
      entries.push(entry);
      zip.readEntry();
    });
    zip.once("end", () => resolve(entries));
    zip.once("error", reject);
    zip.readEntry();
  });
}

const entryStream = (zip: yauzl.ZipFile, entry: yauzl.Entry) =>
  new Promise<Readable>((resolve, reject) =>
    zip.openReadStream(entry, (error, stream) =>
      error || !stream
        ? reject(error ?? new SamExportError("sam.zip_unreadable"))
        : resolve(stream),
    ),
  );

/**
 * Opens the one `AMP-<n>.xml` entry of `file` as a stream. `sam.amp_entry_missing` when there is
 * none, `sam.amp_entry_ambiguous` when there are several (we never guess which one is current).
 */
export async function openAmpEntry(
  file: string,
): Promise<{ readonly stream: Readable; readonly name: string; close(): void }> {
  await assertZip(file);
  const zip = await openZip(file);
  try {
    const amp = (await listEntries(zip)).filter((e) => AMP_ENTRY.test(e.fileName));
    if (amp.length === 0) throw new SamExportError("sam.amp_entry_missing");
    if (amp.length > 1) throw new SamExportError("sam.amp_entry_ambiguous");
    const entry = amp[0] as yauzl.Entry;
    const stream = await entryStream(zip, entry);
    return { stream, name: entry.fileName, close: () => zip.close() };
  } catch (error) {
    zip.close();
    throw error;
  }
}

export interface SamExportSource {
  /** A local ZIP (the manual first run); wins over `url`. */
  readonly file?: string | undefined;
  /** `SAM_EXPORT_URL`: downloaded to a temp folder that `close` deletes. */
  readonly url?: string | undefined;
  readonly maxBytes: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * The `openExport` the import job and the CLI hand to `runSamImportFrom`. `null` when there is
 * neither a file nor a URL (the job is then not scheduled).
 */
export function samExportOpener(source: SamExportSource): (() => Promise<SamExportStream>) | null {
  const { file, url, maxBytes, fetchImpl } = source;
  if (!file && !url) return null;
  return async () => {
    let dir: string | null = null;
    let zipFile = file;
    if (!zipFile) {
      dir = await mkdtemp(path.join(tmpdir(), "igs-sam-"));
      zipFile = path.join(dir, "export.zip");
      try {
        await downloadTo(url as string, zipFile, maxBytes, fetchImpl);
      } catch (error) {
        await rm(dir, { recursive: true, force: true });
        throw error;
      }
    }
    const cleanup = async () => {
      if (dir) await rm(dir, { recursive: true, force: true });
    };
    let entry: Awaited<ReturnType<typeof openAmpEntry>>;
    try {
      entry = await openAmpEntry(zipFile);
    } catch (error) {
      await cleanup();
      throw error;
    }
    return {
      chunks: entry.stream,
      async close() {
        entry.stream.destroy();
        entry.close();
        await cleanup();
      },
    };
  };
}

/** `--file <path>` and `--dry-run`; anything else is refused. */
export function parseSamImportArgs(argv: readonly string[]): { file?: string; dryRun: boolean } {
  let file: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--file" && argv[i + 1]) file = argv[++i];
    else throw new Error(`Unknown argument: ${arg}. Usage: sam-import [--file <zip>] [--dry-run]`);
  }
  return file === undefined ? { dryRun } : { file, dryRun };
}
