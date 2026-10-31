import { NextResponse } from "next/server";

import { PREVIEW_COOKIE, PREVIEW_COOKIE_OPTIONS } from "../../../preview";

export const dynamic = "force-dynamic";

/**
 * `GET /preview/end` (igs-pharma#62): drops the preview cookie and lands on whatever the public sees.
 * The proxy routes it here only while the gate is on and a key is configured; otherwise it is just
 * another closed URL (#91). A route handler, not the proxy, answers it: only a route handler may send
 * a RELATIVE Location (igs-pharma#199: never one built from `request.url`, the container's address).
 */
export function GET(): NextResponse {
  const response = new NextResponse(null, {
    status: 303,
    headers: { location: "/", "cache-control": "no-store" },
  });
  response.cookies.set({ name: PREVIEW_COOKIE, value: "", ...PREVIEW_COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
