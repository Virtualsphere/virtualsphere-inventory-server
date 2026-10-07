import type { RowDataPacket } from "mysql2/promise";
import { pool, type Queryable } from "../../db/pool";
import type { Dispatch } from "../../types";

interface DispatchRow extends RowDataPacket {
  id: string;
  invoice_no: string;
  customer_name: string;
  customer_phone: string;
  gst_no: string | null;
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity: number;
  given_date: string;
  valid_until: string | null;
  notes: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
}

function mapDispatch(row: DispatchRow): Dispatch {
  return {
    id: row.id,
    invoiceNo: row.invoice_no,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    gstNo: row.gst_no,
    productId: row.product_id,
    productName: row.product_name,
    sku: row.product_sku,
    quantity: row.quantity,
    givenDate: row.given_date,
    validUntil: row.valid_until,
    notes: row.notes,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
  };
}

const SELECT_VIEW = `
  SELECT d.*, p.name AS product_name, p.sku AS product_sku,
         COALESCE(NULLIF(us.full_name, ''), us.username) AS created_by_name
  FROM dispatches d
  JOIN products p ON p.id = d.product_id
  LEFT JOIN users us ON us.id = d.created_by`;

export interface InsertableDispatch {
  id: string;
  invoiceNo: string;
  customerName: string;
  customerPhone: string;
  gstNo: string | null;
  productId: string;
  quantity: number;
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
       (id, invoice_no, customer_name, customer_phone, gst_no, product_id,
        quantity, given_date, valid_until, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.id,
      d.invoiceNo,
      d.customerName,
      d.customerPhone,
      d.gstNo,
      d.productId,
      d.quantity,
      d.givenDate,
      d.validUntil,
      d.notes,
      d.createdBy,
    ],
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
  return rows[0] ? mapDispatch(rows[0]) : null;
}

export interface ListDispatchesResult {
  items: Dispatch[];
  total: number;
  limit: number;
  offset: number;
}

export async function listDispatches(opts: {
  q?: string;
  productId?: string;
  limit: number;
  offset: number;
}): Promise<ListDispatchesResult> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts.productId) {
    conds.push("d.product_id = ?");
    params.push(opts.productId);
  }
  if (opts.q) {
    // _ci collation: LIKE is already case-insensitive.
    const like = `%${opts.q}%`;
    conds.push(
      `(d.invoice_no LIKE ? OR d.customer_name LIKE ? OR d.customer_phone LIKE ?
        OR d.gst_no LIKE ? OR p.name LIKE ? OR p.sku LIKE ?
        OR EXISTS (SELECT 1 FROM units su WHERE su.dispatch_id = d.id
                   AND (su.internal_serial LIKE ? OR su.manufacturer_serial LIKE ?)))`,
    );
    params.push(like, like, like, like, like, like, like, like);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM dispatches d JOIN products p ON p.id = d.product_id
     ${where}`,
    params,
  );
  const [rows] = await pool.query<DispatchRow[]>(
    `${SELECT_VIEW} ${where}
     ORDER BY d.given_date DESC, d.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, opts.limit, opts.offset],
  );

  return {
    items: rows.map(mapDispatch),
    total: Number(countRows[0]?.["count"] ?? 0),
    limit: opts.limit,
    offset: opts.offset,
  };
}
