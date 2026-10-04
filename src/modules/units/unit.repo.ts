import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool, type PoolConnection } from "../../db/pool";
import type { Unit, UnitStatus, UnitView } from "../../types";

interface UnitRow extends RowDataPacket {
  id: string;
  product_id: string;
  seq: number;
  internal_serial: string;
  manufacturer_serial: string | null;
  status: UnitStatus;
  intake_date: string;
  warranty_start: string | null;
  warranty_months: number;
  sold_to: string | null;
  sold_date: string | null;
  notes: string;
  created_at: Date;
  updated_at: Date;
}

type UnitViewRow = UnitRow & { product_name: string; product_sku: string };

function mapUnit(row: UnitRow): Unit {
  return {
    id: row.id,
    productId: row.product_id,
    seq: row.seq,
    internalSerial: row.internal_serial,
    manufacturerSerial: row.manufacturer_serial,
    status: row.status,
    intakeDate: row.intake_date,
    warrantyStart: row.warranty_start,
    warrantyMonths: row.warranty_months,
    soldTo: row.sold_to,
    soldDate: row.sold_date,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapUnitView(row: UnitViewRow): UnitView {
  return {
    ...mapUnit(row),
    productName: row.product_name,
    sku: row.product_sku,
  };
}

export interface InsertableUnit {
  productId: string;
  seq: number;
  internalSerial: string;
  manufacturerSerial: string | null;
  intakeDate: string;
  warrantyStart: string | null;
  warrantyMonths: number;
  notes: string;
}

/**
 * Bulk-insert units for ONE product on the given transaction connection.
 * Returns the inserted rows in seq order.
 */
export async function bulkInsertUnits(
  conn: PoolConnection,
  units: InsertableUnit[],
): Promise<Unit[]> {
  if (units.length === 0) return [];
  const cols = [
    "id",
    "product_id",
    "seq",
    "internal_serial",
    "manufacturer_serial",
    "status",
    "intake_date",
    "warranty_start",
    "warranty_months",
    "notes",
  ];
  // `VALUES ?` with a nested array expands client-side into (...), (...) —
  // no server placeholder limit, which matters for 5000-unit intakes.
  const values = units.map((u) => [
    randomUUID(),
    u.productId,
    u.seq,
    u.internalSerial,
    u.manufacturerSerial,
    "in_stock",
    u.intakeDate,
    u.warrantyStart,
    u.warrantyMonths,
    u.notes,
  ]);

  await conn.query(`INSERT INTO units (${cols.join(", ")}) VALUES ?`, [
    values,
  ]);

  // No RETURNING in MySQL: read the batch back by its (contiguous) seq range,
  // inside the same transaction.
  const seqs = units.map((u) => u.seq);
  const [rows] = await conn.query<UnitRow[]>(
    `SELECT * FROM units
     WHERE product_id = ? AND seq BETWEEN ? AND ?
     ORDER BY seq ASC`,
    [units[0]!.productId, Math.min(...seqs), Math.max(...seqs)],
  );
  return rows.map(mapUnit);
}

/** Which of `serials` are already used as an internal serial (any product). */
export async function findExistingInternalSerials(
  conn: PoolConnection,
  serials: string[],
): Promise<string[]> {
  if (serials.length === 0) return [];
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT internal_serial FROM units WHERE internal_serial IN (?)",
    [serials],
  );
  return rows.map((r) => String(r["internal_serial"]));
}

interface UnitFilters {
  q?: string;
  productId?: string;
  status?: UnitStatus;
}

function buildWhere(filters: UnitFilters): {
  clause: string;
  params: unknown[];
} {
  const conds: string[] = [];
  const params: unknown[] = [];

  if (filters.productId) {
    params.push(filters.productId);
    conds.push("u.product_id = ?");
  }
  if (filters.status) {
    params.push(filters.status);
    conds.push("u.status = ?");
  }
  if (filters.q) {
    // Columns use a case-insensitive collation, so LIKE needs no lower().
    const like = `%${filters.q}%`;
    params.push(like, like, like, like);
    conds.push(
      `(u.internal_serial LIKE ?
        OR u.manufacturer_serial LIKE ?
        OR p.name LIKE ?
        OR p.sku LIKE ?)`,
    );
  }

  return {
    clause: conds.length ? `WHERE ${conds.join(" AND ")}` : "",
    params,
  };
}

const ORDER_BY: Record<string, string> = {
  newest: "u.created_at DESC, u.seq DESC",
  oldest: "u.created_at ASC, u.seq ASC",
  serial: "u.internal_serial ASC",
};

export interface ListUnitsResult {
  items: UnitView[];
  total: number;
  limit: number;
  offset: number;
}

export async function listUnits(opts: {
  q?: string;
  productId?: string;
  status?: UnitStatus;
  sort: "newest" | "oldest" | "serial";
  limit: number;
  offset: number;
}): Promise<ListUnitsResult> {
  const { clause, params } = buildWhere(opts);

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM units u JOIN products p ON p.id = u.product_id
     ${clause}`,
    params,
  );
  const total = Number(countRows[0]?.["count"] ?? 0);

  const order = ORDER_BY[opts.sort] ?? ORDER_BY["newest"];
  const [rows] = await pool.query<UnitViewRow[]>(
    `SELECT u.*, p.name AS product_name, p.sku AS product_sku
     FROM units u JOIN products p ON p.id = u.product_id
     ${clause}
     ORDER BY ${order}
     LIMIT ? OFFSET ?`,
    [...params, opts.limit, opts.offset],
  );

  return {
    items: rows.map(mapUnitView),
    total,
    limit: opts.limit,
    offset: opts.offset,
  };
}

/** All matching units, no pagination — used for CSV export. */
export async function listUnitsForExport(
  filters: UnitFilters,
): Promise<UnitView[]> {
  const { clause, params } = buildWhere(filters);
  const [rows] = await pool.query<UnitViewRow[]>(
    `SELECT u.*, p.name AS product_name, p.sku AS product_sku
     FROM units u JOIN products p ON p.id = u.product_id
     ${clause}
     ORDER BY p.name ASC, u.seq ASC`,
    params,
  );
  return rows.map(mapUnitView);
}

export async function listUnitsByProduct(
  productId: string,
): Promise<UnitView[]> {
  const [rows] = await pool.query<UnitViewRow[]>(
    `SELECT u.*, p.name AS product_name, p.sku AS product_sku
     FROM units u JOIN products p ON p.id = u.product_id
     WHERE u.product_id = ?
     ORDER BY u.seq ASC`,
    [productId],
  );
  return rows.map(mapUnitView);
}

export async function findUnitById(id: string): Promise<UnitView | null> {
  const [rows] = await pool.query<UnitViewRow[]>(
    `SELECT u.*, p.name AS product_name, p.sku AS product_sku
     FROM units u JOIN products p ON p.id = u.product_id
     WHERE u.id = ?`,
    [id],
  );
  return rows[0] ? mapUnitView(rows[0]) : null;
}

/** Warranty lookup: match either serial exactly, case-insensitively. */
export async function findUnitBySerial(
  serial: string,
): Promise<UnitView | null> {
  // Case-insensitive via the column collation (and index-friendly).
  const needle = serial.trim();
  const [rows] = await pool.query<UnitViewRow[]>(
    `SELECT u.*, p.name AS product_name, p.sku AS product_sku
     FROM units u JOIN products p ON p.id = u.product_id
     WHERE u.internal_serial = ? OR u.manufacturer_serial = ?
     LIMIT 1`,
    [needle, needle],
  );
  return rows[0] ? mapUnitView(rows[0]) : null;
}

/** Partial-match suggestions for warranty lookup (either serial). */
export async function suggestUnitsBySerial(
  serial: string,
  limit = 8,
): Promise<UnitView[]> {
  const needle = `%${serial.trim()}%`;
  const [rows] = await pool.query<UnitViewRow[]>(
    `SELECT u.*, p.name AS product_name, p.sku AS product_sku
     FROM units u JOIN products p ON p.id = u.product_id
     WHERE u.internal_serial LIKE ? OR u.manufacturer_serial LIKE ?
     ORDER BY u.internal_serial ASC
     LIMIT ?`,
    [needle, needle, limit],
  );
  return rows.map(mapUnitView);
}

export async function updateUnitRow(
  id: string,
  columns: Record<string, unknown>,
): Promise<boolean> {
  const keys = Object.keys(columns);
  if (keys.length === 0) return false;
  const setSql = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => columns[k]);
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE units SET ${setSql}, updated_at = NOW(3) WHERE id = ?`,
    [...values, id],
  );
  return res.affectedRows > 0;
}
