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

/**
 * A UPC-E barcode (8 digits: number system, 6 digits, check digit) as the GTIN-12 it stands for, or
 * `null` when it is not one. UPC-E zero-suppresses a UPC-A, so it must be expanded before the
 * lookup: `01234558` is `012345000058`, not the GTIN-8 `01234558`.
 */
export function expandUpcE(code: string): string | null {
  if (!/^[01][0-9]{7}$/.test(code)) return null;
  const [ns, x1, x2, x3, x4, x5, x6, check] = [...code];
  const last = Number(x6);
  const body =
    last <= 2
      ? `${x1}${x2}${x6}0000${x3}${x4}${x5}`
      : last === 3
        ? `${x1}${x2}${x3}00000${x4}${x5}`
        : last === 4
          ? `${x1}${x2}${x3}${x4}00000${x5}`
          : `${x1}${x2}${x3}${x4}${x5}0000${x6}`;
  const upcA = `${ns}${body}${check}`;
  return hasGs1CheckDigit(upcA) ? upcA : null;
}

/**
 * The scanner's text → a CNK or a GTIN to look up, or `null` when it is no product code. `type` is
 * the barcode type the camera reported (`upc_e` needs expanding; the others are read as they are).
 */
export function readScannedCode(data: string, type?: string): ScannedCode | null {
  if (type === "upc_e") {
    const gtin = expandUpcE(data.trim());
    return gtin ? { kind: "gtin", gtin } : null;
  }
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
