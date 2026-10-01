import { withTransaction } from "../../db/pool";
import type { RowDataPacket } from "mysql2/promise";
import {
  conflict,
  isUniqueViolation as isUnique,
  notFound,
} from "../../lib/errors";
import { formatSerial, productCode } from "../../lib/serial";
import type { Settings, Unit, UnitView } from "../../types";
import { getSettings } from "../settings/settings.repo";
import {
  bulkInsertUnits,
  findUnitById,
  type InsertableUnit,
  listUnits,
  listUnitsByProduct,
  listUnitsForExport,
  type ListUnitsResult,
  updateUnitRow,
} from "./unit.repo";
import type {
  IntakeInput,
  ListUnitsInput,
  UpdateUnitInput,
} from "./unit.schema";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Row shape returned by the locking SELECT inside intake. */
interface LockedProductRow extends RowDataPacket {
  id: string;
  name: string;
  sku: string;
  warranty_months: number;
  serial_prefix: string | null;
  next_seq: number;
}

export interface IntakeResult {
  created: number;
  units: UnitView[];
}

/**
 * INTAKE — the race-free core.
 *
 * The whole operation runs in one InnoDB transaction. `SELECT ... FOR UPDATE`
 * on the product row takes an exclusive row lock, so any other intake on the SAME product
 * blocks until this transaction commits and then reads the updated `next_seq`.
 * That serializes serial allocation per product: no two units can ever be
 * assigned the same sequence number (and the UNIQUE (product_id, seq) and
 * UNIQUE (internal_serial) indexes are the belt-and-braces backstop).
 */
export async function intake(input: IntakeInput): Promise<IntakeResult> {
  const serials = input.manufacturerSerials;
  const count = serials ? serials.length : input.quantity!;
  const intakeDate = input.intakeDate ?? todayISO();

  return withTransaction(async (conn) => {
    const [locked] = await conn.query<LockedProductRow[]>(
      `SELECT id, name, sku, warranty_months, serial_prefix, next_seq
       FROM products
       WHERE id = ?
       FOR UPDATE`,
      [input.productId],
    );
    const product = locked[0];
    if (!product) throw notFound("Product");

    const settings: Settings = await getSettings(conn);
    const prefix = product.serial_prefix ?? settings.serialPrefix ?? "";
    const code = productCode(product.sku, product.name);
    const startSeq = product.next_seq;

    const toInsert: InsertableUnit[] = [];
    for (let i = 0; i < count; i++) {
      const seq = startSeq + i;
      toInsert.push({
        productId: product.id,
        seq,
        internalSerial: formatSerial(prefix, code, seq),
        manufacturerSerial: serials ? serials[i]!.trim() : null,
        intakeDate,
        warrantyStart: intakeDate,
        warrantyMonths: product.warranty_months,
        notes: input.notes,
      });
    }

    let inserted: Unit[];
    try {
      inserted = await bulkInsertUnits(conn, toInsert);
    } catch (err) {
      if (isUnique(err)) {
        throw conflict(
          "One or more manufacturer serials already exist for this product",
          (err as { sqlMessage?: string }).sqlMessage,
        );
      }
      throw err;
    }

    await conn.query(
      "UPDATE products SET next_seq = next_seq + ?, updated_at = NOW(3) WHERE id = ?",
      [count, product.id],
    );

    const units: UnitView[] = inserted.map((u) => ({
      ...u,
      productName: product.name,
      sku: product.sku,
    }));
    return { created: units.length, units };
  });
}

export function listUnitsPaged(input: ListUnitsInput): Promise<ListUnitsResult> {
  return listUnits({
    q: input.q,
    productId: input.productId,
    status: input.status,
    sort: input.sort,
    limit: input.limit,
    offset: input.offset,
  });
}

export async function getUnit(id: string): Promise<UnitView> {
  const unit = await findUnitById(id);
  if (!unit) throw notFound("Unit");
  return unit;
}

export function listUnitsForProduct(productId: string): Promise<UnitView[]> {
  return listUnitsByProduct(productId);
}

export async function updateUnit(
  id: string,
  patch: UpdateUnitInput,
): Promise<UnitView> {
  const existing = await findUnitById(id);
  if (!existing) throw notFound("Unit");

  const columns: Record<string, unknown> = {};
  if (patch.status !== undefined) columns["status"] = patch.status;
  if (patch.manufacturerSerial !== undefined)
    columns["manufacturer_serial"] = patch.manufacturerSerial;
  if (patch.soldTo !== undefined) columns["sold_to"] = patch.soldTo;
  if (patch.soldDate !== undefined) columns["sold_date"] = patch.soldDate;
  if (patch.warrantyStart !== undefined)
    columns["warranty_start"] = patch.warrantyStart;
  if (patch.warrantyMonths !== undefined)
    columns["warranty_months"] = patch.warrantyMonths;
  if (patch.notes !== undefined) columns["notes"] = patch.notes;

  // Convenience: marking a unit sold with no sold date set stamps today.
  if (
    patch.status === "sold" &&
    patch.soldDate === undefined &&
    !existing.soldDate
  ) {
    columns["sold_date"] = todayISO();
  }

  try {
    const ok = await updateUnitRow(id, columns);
    if (!ok) throw notFound("Unit");
  } catch (err) {
    if (isUnique(err)) {
      throw conflict(
        "That manufacturer serial already exists for this product",
      );
    }
    throw err;
  }

  return (await findUnitById(id))!;
}

// --- CSV export -----------------------------------------------------------

const CSV_COLUMNS: Array<[header: string, pick: (u: UnitView) => string]> = [
  ["internal_serial", (u) => u.internalSerial],
  ["manufacturer_serial", (u) => u.manufacturerSerial ?? ""],
  ["product_name", (u) => u.productName],
  ["sku", (u) => u.sku],
  ["status", (u) => u.status],
  ["intake_date", (u) => u.intakeDate],
  ["warranty_start", (u) => u.warrantyStart ?? ""],
  ["warranty_months", (u) => String(u.warrantyMonths)],
  ["sold_to", (u) => u.soldTo ?? ""],
  ["sold_date", (u) => u.soldDate ?? ""],
  ["notes", (u) => u.notes],
];

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function exportUnitsCsv(filters: {
  q?: string;
  productId?: string;
  status?: UnitView["status"];
}): Promise<string> {
  const units = await listUnitsForExport(filters);
  const header = CSV_COLUMNS.map(([h]) => h).join(",");
  const lines = units.map((u) =>
    CSV_COLUMNS.map(([, pick]) => csvCell(pick(u))).join(","),
  );
  return [header, ...lines].join("\r\n");
}
