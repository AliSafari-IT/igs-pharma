import { logger } from "@igs/observability/logger";
import { type CspReportSink, createFloodGuard, handleCspReport } from "@igs/security-headers";

/**
 * CSP violation sink (T-013): parsing, sanitising and the flood guard live in @igs/security-headers.
 * Stateless — no DB, no kernel, no cookies/IP/UA read; nothing is stored.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sink: CspReportSink = {
  warn: (event, fields) => logger.warn({ event, ...fields }, event),
  // No metrics backend yet (OTel is a Phase 1b stub): wire security.csp.* counters here when it lands.
  increment: () => {},
};

const guard = createFloodGuard({ perMinute: 60 });

export function POST(request: Request): Promise<Response> {
  return handleCspReport(request, sink, guard);
}
