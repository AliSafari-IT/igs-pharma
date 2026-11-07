import { brusselsLocal } from "@igs/time";

import { isValidCnk, normalizeGtin } from "../domain";
import { type SamAmp, type SamNode, child, childText, childrenNamed } from "./parse";

/**
 * SAM AMPP → import row (igs-pharma#237). Pure: no database, no clock (the caller passes `today`).
 * One outcome per `<Ampp>` of an `<Amp>`; the checks run in this order and the first that fails
 * decides the outcome (see the catalog README, "SAM import").
 *
 * The element names follow the SAM v2 export model (`ExportActualMedicines`, XSD 5–6). They were
 * not verified against the published XSD from the development environment: the first real run is
 * a `--dry-run`, which reports every outcome and the delivery-modus codes it saw.
 */

/** Why an AMPP is not imported (counted per reason in the run report). */
export const SAM_SKIP_REASONS = [
  "no_public_cnk",
  "invalid_cnk",
  "no_current_data",
  "no_delivery_modus",
  "prescription",
  "missing_name",
] as const;
export type SamSkipReason = (typeof SAM_SKIP_REASONS)[number];

/** Longest product name we store (the content commands' limit). */
export const SAM_NAME_MAX = 200;

/** What the import writes for one pack. */
export interface SamImportRow {
  readonly cnk: string;
  /** 14 digits (`normalizeGtin`), or `null` when SAM has none or an invalid one. */
  readonly gtin: string | null;
  /** SAM gave a GTIN that `normalizeGtin` refused (counted, never stored). */
  readonly gtinInvalid: boolean;
  readonly names: { readonly nl: string; readonly fr: string; readonly de?: string | undefined };
}

export type SamOutcome =
  | { readonly kind: "row"; readonly row: SamImportRow; readonly deliveryModus: string }
  | {
      readonly kind: "skip";
      readonly reason: SamSkipReason;
      readonly deliveryModus?: string;
    }
  /** Not on the market (or not authorised) today: counted, nothing written or deleted. */
  | { readonly kind: "withdrawn"; readonly cnk: string; readonly deliveryModus: string };

export interface SamMapOptions {
  /** The day the import runs, `YYYY-MM-DD` in Europe/Brussels (`brusselsToday`). */
  readonly today: string;
  /**
   * The `DeliveryModus` codes that mean "no prescription". FAIL CLOSED: a pack is OTC only when
   * its code is listed; an empty set imports nothing.
   */
  readonly otcDeliveryModusCodes: ReadonlySet<string>;
}

/** Today's date in Europe/Brussels as `YYYY-MM-DD` (D-003: calendar dates through `@igs/time`). */
export function brusselsToday(now: Date): string {
  const t = brusselsLocal(now.getTime());
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
}

/** The date part of a SAM `from`/`to` attribute (`2024-01-01` or `2024-01-01T00:00:00`). */
const dateOf = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === "" ? undefined : value.trim().slice(0, 10);

/** Whether a `<Data from to>` period covers `today` (`from` inclusive, `to` inclusive, open end). */
export function covers(node: SamNode, today: string): boolean {
  const from = dateOf(node.attrs["from"]);
  const to = dateOf(node.attrs["to"]);
  if (from !== undefined && from > today) return false;
  if (to !== undefined && to < today) return false;
  return true;
}

/** The `<Data>` child in force today (the latest `from` when several overlap). */
export function currentData(node: SamNode | undefined, today: string): SamNode | undefined {
  const valid = childrenNamed(node, "Data").filter((d) => covers(d, today));
  return valid.sort((a, b) =>
    (dateOf(b.attrs["from"]) ?? "").localeCompare(dateOf(a.attrs["from"]) ?? ""),
  )[0];
}

/** A multilingual SAM text (`<Nl>`, `<Fr>`, `<De>` children), trimmed and length-limited. */
function texts(node: SamNode | undefined): { nl?: string; fr?: string; de?: string } {
  const pick = (lang: string) => childText(node, lang)?.replace(/\s+/g, " ").slice(0, SAM_NAME_MAX);
  const out: { nl?: string; fr?: string; de?: string } = {};
  const nl = pick("Nl");
  const fr = pick("Fr");
  const de = pick("De");
  if (nl) out.nl = nl;
  if (fr) out.fr = fr;
  if (de) out.de = de;
  return out;
}

/** The public-pharmacy CNK of an AMPP: `Dmpp codeType="CNK" deliveryEnvironment="P"`. */
function publicCnk(ampp: SamNode): string | undefined {
  const dmpp = childrenNamed(ampp, "Dmpp").find(
    (d) => d.attrs["codeType"] === "CNK" && d.attrs["deliveryEnvironment"] === "P",
  );
  const code = dmpp?.attrs["code"]?.trim();
  return code ? code : undefined;
}

/** One outcome per `<Ampp>` of `amp`. */
export function mapAmp(amp: SamAmp, options: SamMapOptions): SamOutcome[] {
  const { today } = options;
  const ampNames = texts(child(currentData(amp, today), "Name"));
  return childrenNamed(amp, "Ampp").map((ampp) => mapAmpp(ampp, ampNames, options));
}

function mapAmpp(
  ampp: SamNode,
  ampNames: { nl?: string; fr?: string; de?: string },
  { today, otcDeliveryModusCodes }: SamMapOptions,
): SamOutcome {
  const cnk = publicCnk(ampp);
  if (cnk === undefined) return { kind: "skip", reason: "no_public_cnk" };
  if (!isValidCnk(cnk)) return { kind: "skip", reason: "invalid_cnk" };

  const data = currentData(ampp, today);
  if (!data) return { kind: "skip", reason: "no_current_data" };

  const deliveryModus = child(data, "DeliveryModus")?.attrs["code"]?.trim();
  if (!deliveryModus) return { kind: "skip", reason: "no_delivery_modus" };
  if (!otcDeliveryModusCodes.has(deliveryModus))
    return { kind: "skip", reason: "prescription", deliveryModus };

  const packNames = texts(child(data, "PrescriptionNameFamhp"));
  const nl = packNames.nl ?? ampNames.nl;
  const fr = packNames.fr ?? ampNames.fr;
  const de = packNames.de ?? ampNames.de;
  if (!nl || !fr) return { kind: "skip", reason: "missing_name", deliveryModus };

  const authorised = childText(data, "Status") === "AUTHORIZED";
  const marketed = childrenNamed(child(ampp, "Commercialization"), "Data").some((d) =>
    covers(d, today),
  );
  if (!authorised || !marketed) return { kind: "withdrawn", cnk, deliveryModus };

  const rawGtin = childText(data, "Gtin");
  const gtin = rawGtin === undefined ? null : normalizeGtin(rawGtin);
  return {
    kind: "row",
    deliveryModus,
    row: {
      cnk,
      gtin,
      gtinInvalid: rawGtin !== undefined && gtin === null,
      names: de ? { nl, fr, de } : { nl, fr },
    },
  };
}
