import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { pool, type Queryable } from "../../db/pool";
import type { Dispatch, DispatchItem } from "../../types";

interface DispatchRow extends RowDataPacket {
  id: string;
  invoice_no: string;
  customer_name: string;
  customer_phone: string;
  gst_no: string | null;
  given_date: string;
  valid_until: string | null;
  notes: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
}

interface DispatchItemRow extends RowDataPacket {
  id: string;
  dispatch_id: string;
  module_id: string;
  module_name: string;
  module_sku: string;
  product_id: string;
  product_name: string;
  quantity: number;
}

function mapItem(row: DispatchItemRow): DispatchItem {
  return {
    id: row.id,
    moduleId: row.module_id,
    moduleName: row.module_name,
    sku: row.module_sku,
    productId: row.product_id,
    productName: row.product_name,
    quantity: row.quantity,
  };
}

function mapDispatch(row: DispatchRow, items: DispatchItem[]): Dispatch {
  return {
    id: row.id,
    invoiceNo: row.invoice_no,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    gstNo: row.gst_no,
    quantity: items.reduce((n, i) => n + i.quantity, 0),
    items,
    givenDate: row.given_date,
    validUntil: row.valid_until,
    notes: row.notes,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
  };
}

const SELECT_VIEW = `
  SELECT d.*, COALESCE(NULLIF(us.full_name, ''), us.username) AS created_by_name
  FROM dispatches d
  LEFT JOIN users us ON us.id = d.created_by`;

/** The lines of the given hand-overs, grouped by dispatch id, in product/module order. */
async function itemsByDispatch(
  conn: Queryable,
  dispatchIds: string[],
): Promise<Map<string, DispatchItem[]>> {
  const byId = new Map<string, DispatchItem[]>(dispatchIds.map((id) => [id, []]));
  if (dispatchIds.length === 0) return byId;
  const [rows] = await conn.query<DispatchItemRow[]>(
    `SELECT i.id, i.dispatch_id, i.module_id, i.quantity,
            m.name AS module_name, m.sku AS module_sku,
            p.id AS product_id, p.name AS product_name
     FROM dispatch_items i
     JOIN modules m ON m.id = i.module_id
     JOIN products p ON p.id = m.product_id
     WHERE i.dispatch_id IN (?)
     ORDER BY p.name ASC, m.name ASC`,
    [dispatchIds],
  );
  for (const row of rows) byId.get(row.dispatch_id)!.push(mapItem(row));
  return byId;
}

export interface InsertableDispatch {
  id: string;
  invoiceNo: string;
  customerName: string;
  customerPhone: string;
  gstNo: string | null;
  givenDate: string;
  validUntil: string | null;
  notes: string;
  createdBy: string | null;
}

export async function insertDispatch(
  conn: Queryable,
  d: InsertableDispatch,
): Promise<void> {
  await conn.query(
    `INSERT INTO dispatches
       (id, invoice_no, customer_name, customer_phone, gst_no,
        given_date, valid_until, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.id,
      d.invoiceNo,
      d.customerName,
      d.customerPhone,
      d.gstNo,
      d.givenDate,
      d.validUntil,
      d.notes,
      d.createdBy,
    ],
  );
}

export async function insertDispatchItem(
  conn: Queryable,
  dispatchId: string,
  moduleId: string,
  quantity: number,
): Promise<void> {
  await conn.query(
    "INSERT INTO dispatch_items (id, dispatch_id, module_id, quantity) VALUES (?, ?, ?, ?)",
    [randomUUID(), dispatchId, moduleId, quantity],
  );
}

export async function findDispatchById(
  id: string,
  conn: Queryable = pool,
): Promise<Dispatch | null> {
  const [rows] = await conn.query<DispatchRow[]>(
    `${SELECT_VIEW} WHERE d.id = ?`,
    [id],
  );
  if (!rows[0]) return null;
  const items = await itemsByDispatch(conn, [id]);
  return mapDispatch(rows[0], items.get(id)!);
}

export interface ListDispatchesResult {
  items: Dispatch[];
  total: number;
  limit: number;
  offset: number;
}

export async function listDispatches(opts: {
  q?: string;
  moduleId?: string;
  productId?: string;
  limit: number;
  offset: number;
}): Promise<ListDispatchesResult> {
  const conds: string[] = [];
  const params: unknown[] = [];
  // Module / product filters match a hand-over if ANY of its lines matches.
  if (opts.moduleId) {
    conds.push(
      "EXISTS (SELECT 1 FROM dispatch_items fi WHERE fi.dispatch_id = d.id AND fi.module_id = ?)",
    );
    params.push(opts.moduleId);
  }
  if (opts.productId) {
    conds.push(
      `EXISTS (SELECT 1 FROM dispatch_items fi JOIN modules fm ON fm.id = fi.module_id
               WHERE fi.dispatch_id = d.id AND fm.product_id = ?)`,
    );
    params.push(opts.productId);
  }
  if (opts.q) {
    // _ci collation: LIKE is already case-insensitive.
    const like = `%${opts.q}%`;
    conds.push(
      `(d.invoice_no LIKE ? OR d.customer_name LIKE ? OR d.customer_phone LIKE ?
        OR d.gst_no LIKE ?
        OR EXISTS (SELECT 1 FROM dispatch_items si
                   JOIN modules sm ON sm.id = si.module_id
                   JOIN products sp ON sp.id = sm.product_id
                   WHERE si.dispatch_id = d.id
                     AND (sp.name LIKE ? OR sm.name LIKE ? OR sm.sku LIKE ?))
        OR EXISTS (SELECT 1 FROM units su WHERE su.dispatch_id = d.id
                   AND (su.internal_serial LIKE ? OR su.manufacturer_serial LIKE ?)))`,
    );
    params.push(like, like, like, like, like, like, like, like, like);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM dispatches d ${where}`,
    params,
  );
  const [rows] = await pool.query<DispatchRow[]>(
    `${SELECT_VIEW} ${where}
     ORDER BY d.given_date DESC, d.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, opts.limit, opts.offset],
  );
  const items = await itemsByDispatch(pool, rows.map((r) => r.id));

  return {
    items: rows.map((r) => mapDispatch(r, items.get(r.id)!)),
    total: Number(countRows[0]?.["count"] ?? 0),
    limit: opts.limit,
    offset: opts.offset,
  };
}
