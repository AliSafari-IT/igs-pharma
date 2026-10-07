/**
 * Phase 0 OpenTelemetry stub.
 * Phase 1b: wire @opentelemetry/sdk-node with OTLP exporter.
 *
 * No-op trace/span helpers so callers can import without error.
 */

export function initOtel(_serviceName: string): void {
  // Phase 1b: initialize OpenTelemetry SDK
  // import { NodeSDK } from "@opentelemetry/sdk-node";
  // import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
  if (process.env["NODE_ENV"] === "development") {
    // eslint intentionally omitted — this is the one allowed console call in boot code
    process.stdout.write("[otel] OpenTelemetry stub — not yet configured\n");
  }
}

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
}

/** No-op span for Phase 0. Replace with real OTel spans in Phase 1b. */
export function startSpan(_name: string): Span {
  return { setAttribute: () => {}, end: () => {} };
}
