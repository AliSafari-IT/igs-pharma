/**
 * What a scanned barcode means for the app (1.1, "scan a pack"). Belgian packs no longer have to
 * print the CNK; their linear barcode (EAN-13, EAN-8, UPC) and their 2D code (GS1 DataMatrix, with
 * the GTIN after application identifier 01) carry a GTIN, which the storefront maps to the CNK.
 * A 7-digit code is read as a CNK (a shelf label or an older pack).
 */
export type ScannedCode =
  | { readonly kind: "cnk"; readonly cnk: string }
  | { readonly kind: "gtin"; readonly gtin: string };

const GTIN_LENGTHS = [8, 12, 13, 14];
/** GS1's group separator (FNC1) between variable-length fields of a DataMatrix. */
const GS = "\u001d";

/** Whether the last digit of `digits` is its GS1 check digit (mod 10, weights 3/1 from the right). */
export function hasGs1CheckDigit(digits: string): boolean {
  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) {
    sum += Number(digits[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

const isGtin = (digits: string) =>
  GTIN_LENGTHS.includes(digits.length) && /^[0-9]+$/.test(digits) && hasGs1CheckDigit(digits);

/** The scanner's text → a CNK or a GTIN to look up, or `null` when it is no product code. */
export function readScannedCode(data: string): ScannedCode | null {
  let text = data.trim();
  // a symbology identifier some scanners put in front (]d2 DataMatrix, ]C1 GS1-128, ]e0 …)
  text = text.replace(/^\][A-Za-z][0-9]/, "");
  if (text.startsWith(GS)) text = text.slice(1);
  // GS1 element string: (01) GTIN-14 first, the serial, batch and expiry after it are ignored
  const gs1 = /^\(?01\)?([0-9]{14})/.exec(text);
  if (gs1?.[1] && hasGs1CheckDigit(gs1[1])) return { kind: "gtin", gtin: gs1[1] };
  if (/^[0-9]{7}$/.test(text)) return { kind: "cnk", cnk: text };
  if (isGtin(text)) return { kind: "gtin", gtin: text };
  return null;
}
