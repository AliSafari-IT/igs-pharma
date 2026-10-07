import { createRequire } from "node:module";

import { pino } from "pino";

/**
 * PII-aware structured logger.
 *
 * Fields in PII_ALLOW_LIST are logged as-is.
 * Any other field whose name matches PII_DENY_PATTERN is redacted.
 *
 * This is a Phase 0 stub — the allow-list will grow in Phase 1.
 */
const PII_ALLOW_LIST = new Set([
  "requestId",
  "traceId",
  "spanId",
  "userId",
  "orderId",
  "duration",
  "statusCode",
  "method",
  "path",
  "level",
  "msg",
  "time",
]);

const PII_DENY_PATTERN = /email|phone|name|address|dob|bsn|cnk|password|token|secret/i;

function redactPii(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (PII_ALLOW_LIST.has(key)) {
      result[key] = value;
    } else if (PII_DENY_PATTERN.test(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** pino-pretty is an optional dev nicety (not a declared dependency): fall back to JSON without it. */
function prettyAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve("pino-pretty");
    return true;
  } catch {
    return false;
  }
}

const usePretty = process.env["NODE_ENV"] !== "production" && prettyAvailable();

export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  ...(usePretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
  serializers: {
    req: (req: Record<string, unknown>) => redactPii(req),
  },
});

export type Logger = typeof logger;
