/**
 * CSP violation sink shared by both apps' `app/api/csp-report/route.ts` (T-013, extends D-031).
 * Stateless: nothing is stored. Reports are parsed, sanitised (no query strings, fragments, samples,
 * IP or user agent) and handed to a sink port; this package imports nothing in-repo, so the apps wire
 * the sink to @igs/observability.
 */
import { z } from "zod";

/** Where sanitised reports go. Apps wire `warn` to the logger and `increment` to metrics. */
export interface CspReportSink {
  warn(event: string, fields: Readonly<Record<string, unknown>>): void;
  /** Labels must stay low-cardinality: only the directive, never a URL. */
  increment(name: string, labels?: Readonly<Record<string, string>>, value?: number): void;
}

export const CSP_VIOLATION_EVENT = "security.csp.violation";
export const CSP_DROPPED_EVENT = "security.csp.report_dropped";

/** Body cap, enforced on the stream (content-length is not trusted). */
export const CSP_REPORT_MAX_BYTES = 16 * 1024;

/** A sanitised violation: the only shape that ever reaches the sink. */
export type SanitisedCspViolation = {
  directive: string;
  disposition?: "enforce" | "report";
  documentUri?: string;
  blockedUri?: string;
  sourceFile?: string;
  referrer?: string;
  statusCode?: number;
  lineNumber?: number;
  columnNumber?: number;
};

// --- flood guard --------------------------------------------------------------------------------

export interface FloodGuard {
  /** true: log this report; false: dropped (counted, flushed as one metric per minute). */
  take(sink: CspReportSink): boolean;
}

/**
 * Per-process token bucket protecting the logs (real rate limiting is B-10): `perMinute` tokens,
 * refilled continuously. Drops are counted and reported at most once per minute as a
 * `security.csp.report_dropped` increment plus one `warn` line carrying `{ dropped: n }`.
 */
export function createFloodGuard({
  perMinute = 60,
  now = Date.now,
}: { perMinute?: number; now?: () => number } = {}): FloodGuard {
  const refillPerMs = perMinute / 60_000;
  let tokens = perMinute;
  let last = now();
  let dropped = 0;
  let windowStart = last;

  return {
    take(sink) {
      const t = now();
      tokens = Math.min(perMinute, tokens + (t - last) * refillPerMs);
      last = t;
      if (t - windowStart >= 60_000) {
        if (dropped > 0) {
          sink.increment(CSP_DROPPED_EVENT, {}, dropped);
          // metrics are a no-op until OTel lands: the summary must stay visible in the logs
          sink.warn(CSP_DROPPED_EVENT, { dropped });
        }
        dropped = 0;
        windowStart = t;
      }
      if (tokens >= 1) {
        tokens -= 1;
        return true;
      }
      dropped += 1;
      return false;
    },
  };
}

// --- parsing --------------------------------------------------------------------------------------

const text = z.string().max(4096);
const int = z.number().int().nonnegative().max(1_000_000_000);
const disposition = z.enum(["enforce", "report"]);

/** `application/csp-report` (report-uri). Unknown keys (script-sample, original-policy…) are stripped. */
const legacyReport = z.object({
  "csp-report": z.object({
    "document-uri": text.optional(),
    referrer: text.optional(),
    "blocked-uri": text.optional(),
    "source-file": text.optional(),
    "violated-directive": text.optional(),
    "effective-directive": text.optional(),
    disposition: disposition.optional(),
    "status-code": int.optional(),
    "line-number": int.optional(),
    "column-number": int.optional(),
  }),
});

/** `application/reports+json` (report-to). Unknown keys (user_agent, sample…) are stripped. */
const reportingApiReport = z.object({
  type: z.string().max(64),
  body: z
    .object({
      documentURL: text.optional(),
      referrer: text.optional(),
      blockedURL: text.optional(),
      sourceFile: text.optional(),
      effectiveDirective: text.optional(),
      disposition: disposition.optional(),
      statusCode: int.optional(),
      lineNumber: int.optional(),
      columnNumber: int.optional(),
    })
    .optional(),
});
const reportingApiBatch = z.array(reportingApiReport).max(100);

// --- sanitising -----------------------------------------------------------------------------------

/** blocked-uri values that are keywords, not URLs: kept as-is. */
const BLOCKED_KEYWORDS = new Set([
  "inline",
  "eval",
  "data",
  "blob",
  "wasm-eval",
  "trusted-types-policy",
  "trusted-types-sink",
]);

/** Origin + path only: drops query string, fragment and credentials (URLs can carry tokens/health context). */
function originAndPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:")
      return `${url.origin}${url.pathname}`;
    return url.protocol.slice(0, -1); // data:, blob:, chrome-extension: … → the scheme only
  } catch {
    return "[unparseable]";
  }
}

function sanitiseBlocked(value: string | undefined): string | undefined {
  if (value && BLOCKED_KEYWORDS.has(value)) return value;
  return originAndPath(value);
}

/** Known CSP directives: anything else becomes "other", so a forged report can't add label values. */
const DIRECTIVES = new Set([
  "default-src",
  "script-src",
  "script-src-elem",
  "script-src-attr",
  "style-src",
  "style-src-elem",
  "style-src-attr",
  "img-src",
  "font-src",
  "connect-src",
  "media-src",
  "object-src",
  "frame-src",
  "child-src",
  "worker-src",
  "manifest-src",
  "base-uri",
  "form-action",
  "frame-ancestors",
  "require-trusted-types-for",
  "trusted-types",
  "upgrade-insecure-requests",
]);

/** The directive name only (legacy `violated-directive` may carry the sources after it). */
function directiveName(value: string | undefined): string {
  const name = value?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return DIRECTIVES.has(name) ? name : "other";
}

/** Drops absent fields (exactOptionalPropertyTypes: optional keys are omitted, never undefined). */
function compact(
  v: {
    [K in keyof SanitisedCspViolation]-?: SanitisedCspViolation[K] | undefined;
  },
): SanitisedCspViolation {
  return Object.fromEntries(
    Object.entries(v).filter(([, x]) => x !== undefined),
  ) as SanitisedCspViolation;
}

/** Parses either report format into sanitised violations. Returns null on a malformed body. */
export function parseCspReport(
  mediaType: "application/csp-report" | "application/reports+json",
  json: unknown,
): SanitisedCspViolation[] | null {
  if (mediaType === "application/csp-report") {
    const parsed = legacyReport.safeParse(json);
    if (!parsed.success) return null;
    const r = parsed.data["csp-report"];
    return [
      compact({
        directive: directiveName(r["effective-directive"] ?? r["violated-directive"]),
        disposition: r.disposition,
        documentUri: originAndPath(r["document-uri"]),
        blockedUri: sanitiseBlocked(r["blocked-uri"]),
        sourceFile: originAndPath(r["source-file"]),
        referrer: originAndPath(r.referrer),
        statusCode: r["status-code"],
        lineNumber: r["line-number"],
        columnNumber: r["column-number"],
      }),
    ];
  }
  const parsed = reportingApiBatch.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data.flatMap((report) => {
    const b = report.body;
    if (report.type !== "csp-violation" || !b) return []; // other report types are not ours
    return [
      compact({
        directive: directiveName(b.effectiveDirective),
        disposition: b.disposition,
        documentUri: originAndPath(b.documentURL),
        blockedUri: sanitiseBlocked(b.blockedURL),
        sourceFile: originAndPath(b.sourceFile),
        referrer: originAndPath(b.referrer),
        statusCode: b.statusCode,
        lineNumber: b.lineNumber,
        columnNumber: b.columnNumber,
      }),
    ];
  });
}

// --- HTTP handler ---------------------------------------------------------------------------------

const MEDIA_TYPES = new Set(["application/csp-report", "application/reports+json"]);

/** Reads at most `max` bytes from the body stream; null when the body is larger. */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const status = (code: number) => new Response(null, { status: code });

/**
 * POST handler for the CSP violation sink: 204 accepted, 400 malformed, 405 not POST, 413 over
 * CSP_REPORT_MAX_BYTES, 415 wrong media type. Reads no cookies, IP or user agent.
 */
export async function handleCspReport(
  request: Request,
  sink: CspReportSink,
  guard: FloodGuard,
): Promise<Response> {
  if (request.method !== "POST") return status(405);
  const mediaType =
    (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!MEDIA_TYPES.has(mediaType)) return status(415);

  const bytes = await readCapped(request, CSP_REPORT_MAX_BYTES);
  if (bytes === null) return status(413);

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return status(400);
  }
  const violations = parseCspReport(
    mediaType as "application/csp-report" | "application/reports+json",
    json,
  );
  if (violations === null) return status(400);

  for (const violation of violations) {
    sink.increment(CSP_VIOLATION_EVENT, { directive: violation.directive });
    if (guard.take(sink)) sink.warn(CSP_VIOLATION_EVENT, violation);
  }
  return status(204);
}
