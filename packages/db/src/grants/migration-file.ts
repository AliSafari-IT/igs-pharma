/**
 * A generated grants migration is a leading comment header (up to the first blank line) followed by
 * the SQL rendered from the manifest. The header is hand-written; only the body must equal the
 * generator output.
 */
export function splitHeader(content: string): { header: string; body: string } {
  const end = content.indexOf("\n\n");
  if (end === -1) return { header: content.trimEnd(), body: "" };
  return { header: content.slice(0, end), body: content.slice(end + 2).trimEnd() };
}
