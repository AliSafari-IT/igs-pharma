import type { ContentLocale } from "@igs/module-catalog";
import { logger } from "@igs/observability/logger";
import { NextResponse } from "next/server";

import { isDomainError } from "@igs/kernel";

import { localeOf } from "./storefront";

/**
 * The read-only JSON the Android app reads (`apps/mobile`, asafarim-docs
 * ventures/igs-pharma/09-mobile). `v1` never changes shape: the app copies these types, and a
 * breaking change is `v2`. Errors carry a stable code only, never a message, a stack or the input.
 */
export type MobileErrorCode = "invalid_input" | "not_found" | "unavailable" | "coming_soon";

/** The app's language, from `?locale=`; Dutch when absent, `null` for one the storefront lacks. */
export function mobileLocale(params: URLSearchParams): ContentLocale | null {
  const value = params.get("locale");
  return value === null ? "nl" : localeOf(value);
}

/** Public catalogue data: a short shared cache, the same for every caller. */
export function mobileJson(body: unknown): NextResponse {
  return NextResponse.json(body, {
    headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
  });
}

export function mobileError(code: MobileErrorCode, status: number): NextResponse {
  return NextResponse.json({ error: code }, { status, headers: { "cache-control": "no-store" } });
}

/**
 * A thrown storefront error as the app sees it: bad input 400, an unknown product or category 404,
 * anything else 503 (logged with `event`, never the query text).
 */
export function mobileFailure(error: unknown, event: string): NextResponse {
  if (isDomainError(error)) {
    if (error.kind === "ValidationFailed") return mobileError("invalid_input", 400);
    if (error.kind === "NotFound") return mobileError("not_found", 404);
  }
  logger.error({ event, err: error }, event);
  return mobileError("unavailable", 503);
}
