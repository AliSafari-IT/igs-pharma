/**
 * What counts as the person's own activity (igs-pharma#95). Only an interactive request restarts a
 * staff session's 30-minute idle clock; background traffic never does, or an open tab polling in
 * the background would keep a session alive forever. Recognised on the server from headers the
 * browser itself sets (`Sec-Fetch-*`) and the ones Next.js sets for its own requests; a request
 * that is not positively recognised as interactive is background.
 *
 * Interactive: a document navigation or form post, a Server Action, a client-side navigation.
 * Background: prefetches, and anything marked `x-igs-background` (our own polling, if ever added).
 * The browser's session check (`/api/auth/get-session`) is a route handler and is excluded again
 * in the auth plugin.
 */
export function isInteractiveRequest(headers: Pick<Headers, "get">): boolean {
  if (headers.get("x-igs-background")) return false;
  if (headers.get("next-router-prefetch")) return false;
  const purpose = `${headers.get("purpose") ?? ""} ${headers.get("sec-purpose") ?? ""}`;
  if (/prefetch|prerender/i.test(purpose)) return false;
  // #100: `next-action` and `rsc` are plain headers any script can add, so alone they prove nothing.
  // A browser always adds `Sec-Fetch-Site`, and a page of ours reaching our own server says
  // `same-origin` (or `none` for a typed address): without that it is not the person's request.
  const site = headers.get("sec-fetch-site");
  if (site !== "same-origin" && site !== "none") return false;
  if (headers.get("next-action")) return true;
  if (headers.get("rsc")) return true;
  return headers.get("sec-fetch-dest") === "document";
}
