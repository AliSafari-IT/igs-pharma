import { SaxesParser } from "saxes";

/**
 * Streaming reader of the SAM v2 `AMP-<n>.xml` export (igs-pharma#237). No I/O: it consumes the
 * chunks the caller gives it (the worker streams them out of the ZIP) and yields one `<Amp>` at a
 * time as a small element tree, so memory holds one AMP (its AMPPs and DMPPs), never the file.
 *
 * Elements are matched by their LOCAL name (`ns4:Amp` → `Amp`): the export's prefixes are not part
 * of the contract. `saxes` reads no DTD and expands no external entity, so a hostile file cannot
 * make it fetch anything or grow without bound through entities.
 */

/** One XML element: local name, attributes (local names), child elements and its own text. */
export interface SamNode {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: SamNode[];
  text: string;
}

/** An `<Amp>` element and everything under it. */
export type SamAmp = SamNode;

/** A single element's text above this is cut (names are short; this only bounds hostile input). */
const MAX_TEXT = 10_000;
/** An `<Amp>` with more elements than this is refused: a real one has a few hundred at most. */
export const MAX_NODES_PER_AMP = 50_000;

const localName = (qualified: string): string => {
  const at = qualified.indexOf(":");
  return at === -1 ? qualified : qualified.slice(at + 1);
};

/** Yields every `<Amp>` of the export, in document order. Throws on malformed XML. */
export async function* parseSamAmps(
  chunks: AsyncIterable<string | Uint8Array>,
): AsyncGenerator<SamAmp> {
  const parser = new SaxesParser({ xmlns: false, position: false });
  const done: SamAmp[] = [];
  const stack: SamNode[] = [];
  let nodes = 0;

  parser.on("opentag", (tag) => {
    const name = localName(tag.name);
    if (stack.length === 0 && name !== "Amp") return; // outside an Amp: the export envelope
    if (++nodes > MAX_NODES_PER_AMP) throw new Error("sam.amp_too_large");
    const attrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(tag.attributes)) {
      const attr = localName(key);
      if (attr !== "xmlns" && !key.startsWith("xmlns")) attrs[attr] = String(value);
    }
    const node: SamNode = { name, attrs, children: [], text: "" };
    stack.at(-1)?.children.push(node);
    stack.push(node);
  });
  parser.on("text", (text) => {
    const node = stack.at(-1);
    if (node && node.text.length < MAX_TEXT) node.text = (node.text + text).slice(0, MAX_TEXT);
  });
  parser.on("cdata", (text) => {
    const node = stack.at(-1);
    if (node && node.text.length < MAX_TEXT) node.text = (node.text + text).slice(0, MAX_TEXT);
  });
  parser.on("closetag", () => {
    const node = stack.pop();
    if (node && stack.length === 0) {
      done.push(node);
      nodes = 0;
    }
  });

  const decoder = new TextDecoder("utf-8", { fatal: true });
  for await (const chunk of chunks) {
    parser.write(typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }));
    while (done.length > 0) yield done.shift() as SamAmp;
  }
  const tail = decoder.decode();
  if (tail) parser.write(tail);
  parser.close();
  while (done.length > 0) yield done.shift() as SamAmp;
}

/** The first child element called `name`, if any. */
export const child = (node: SamNode | undefined, name: string): SamNode | undefined =>
  node?.children.find((c) => c.name === name);

/** Every child element called `name`. */
export const childrenNamed = (node: SamNode | undefined, name: string): SamNode[] =>
  node?.children.filter((c) => c.name === name) ?? [];

/** The trimmed text of the child element `name`, or `undefined` when it is missing or empty. */
export const childText = (node: SamNode | undefined, name: string): string | undefined => {
  const text = child(node, name)?.text.trim();
  return text ? text : undefined;
};
