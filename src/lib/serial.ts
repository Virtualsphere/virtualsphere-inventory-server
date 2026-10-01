/**
 * Internal-serial formatting.
 *
 * Final shape:  PREFIX-PRODUCTCODE-NNNNN   e.g.  ACM-VLD1030-00001
 * The prefix is optional; empty segments are dropped.
 */

/** Derive a stable, URL/label-safe product code from SKU (fallback: name). */
export function productCode(sku: string, name: string): string {
  const base = (sku || name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return base || "ITEM";
}

/** Build one internal serial. `seq` is zero-padded to 5 digits. */
export function formatSerial(
  prefix: string,
  code: string,
  seq: number,
): string {
  const n = String(seq).padStart(5, "0");
  return [prefix.trim(), code, n].filter((s) => s.length > 0).join("-");
}
