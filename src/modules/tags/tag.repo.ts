import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool, type Queryable } from "../../db/pool";
import type { StockIntake, Tag, TagGiven } from "../../types";

interface TagRow extends RowDataPacket {
  id: string;
  name: string;
  description: string;
  in_stock: number;
  total_added: number;
  total_given: number;
  created_at: Date;
  updated_at: Date;
}

function mapTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    inStock: row.in_stock,
    totalAdded: row.total_added,
    totalGiven: row.total_given,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// SUM() yields DECIMAL (a string in mysql2), hence the CAST.
const SELECT_SQL = `
  SELECT t.*,
         CAST((SELECT COALESCE(SUM(i.quantity), 0) FROM tag_intakes i WHERE i.tag_id = t.id) AS SIGNED)
           AS total_added,
         CAST((SELECT COALESCE(SUM(g.quantity), 0) FROM dispatch_tags g WHERE g.tag_id = t.id) AS SIGNED)
           AS total_given
  FROM tags t`;

export async function listTagRows(): Promise<Tag[]> {
  const [rows] = await pool.query<TagRow[]>(`${SELECT_SQL} ORDER BY t.name ASC`);
  return rows.map(mapTag);
}

export async function findTagById(
  id: string,
  conn: Queryable = pool,
): Promise<Tag | null> {
  const [rows] = await conn.query<TagRow[]>(`${SELECT_SQL} WHERE t.id = ?`, [id]);
  return rows[0] ? mapTag(rows[0]) : null;
}

export async function insertTag(
  conn: Queryable,
  data: { name: string; description: string; inStock: number },
): Promise<string> {
  // MySQL has no RETURNING: generate the id here.
  const id = randomUUID();
  await conn.query(
    "INSERT INTO tags (id, name, description, in_stock) VALUES (?, ?, ?, ?)",
    [id, data.name, data.description, data.inStock],
  );
  return id;
}

export async function updateTagRow(
  id: string,
  columns: Record<string, unknown>,
): Promise<boolean> {
  const keys = Object.keys(columns);
  if (keys.length === 0) return false;
  const setSql = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => columns[k]);
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE tags SET ${setSql}, updated_at = NOW(3) WHERE id = ?`,
    [...values, id],
  );
  return res.affectedRows > 0;
}

export async function deleteTagRow(id: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>("DELETE FROM tags WHERE id = ?", [id]);
  return res.affectedRows > 0;
}

/**
 * Move a tag's stock by `delta` (negative takes stock out). Refuses — returns
 * false — when the tag is missing or would drop below zero.
 */
export async function changeTagStock(
  conn: Queryable,
  id: string,
  delta: number,
): Promise<boolean> {
  const [res] = await conn.query<ResultSetHeader>(
    `UPDATE tags SET in_stock = in_stock + ?, updated_at = NOW(3)
     WHERE id = ? AND in_stock + ? >= 0`,
    [delta, id, delta],
  );
  return res.affectedRows > 0;
}

export async function insertTagIntake(
  conn: Queryable,
  data: {
    tagId: string;
    quantity: number;
    intakeDate: string;
    notes: string;
    createdBy: string | null;
  },
): Promise<void> {
  await conn.query(
    `INSERT INTO tag_intakes (id, tag_id, quantity, intake_date, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), data.tagId, data.quantity, data.intakeDate, data.notes, data.createdBy],
  );
}

interface TagIntakeRow extends RowDataPacket {
  id: string;
  quantity: number;
  intake_date: string;
  notes: string;
  created_by_name: string | null;
  created_at: Date;
}

export async function listTagIntakes(tagId: string): Promise<StockIntake[]> {
  const [rows] = await pool.query<TagIntakeRow[]>(
    `SELECT i.id, i.quantity, i.intake_date, i.notes, i.created_at,
            COALESCE(NULLIF(us.full_name, ''), us.username) AS created_by_name
     FROM tag_intakes i
     LEFT JOIN users us ON us.id = i.created_by
     WHERE i.tag_id = ?
     ORDER BY i.intake_date DESC, i.created_at DESC`,
    [tagId],
  );
  return rows.map((r) => ({
    id: r.id,
    quantity: r.quantity,
    intakeDate: r.intake_date,
    notes: r.notes,
    createdByName: r.created_by_name,
    createdAt: r.created_at.toISOString(),
  }));
}

/** Lock one intake of `tagId` for undo; null when there is none. */
export async function lockTagIntake(
  conn: Queryable,
  tagId: string,
  intakeId: string,
): Promise<{ quantity: number } | null> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT quantity FROM tag_intakes WHERE id = ? AND tag_id = ? FOR UPDATE",
    [intakeId, tagId],
  );
  return rows[0] ? { quantity: Number(rows[0]["quantity"]) } : null;
}

export async function deleteTagIntakeRow(conn: Queryable, intakeId: string): Promise<void> {
  await conn.query("DELETE FROM tag_intakes WHERE id = ?", [intakeId]);
}

interface TagGivenRow extends RowDataPacket {
  dispatch_id: string;
  invoice_no: string;
  customer_name: string;
  given_date: string;
  quantity: number;
}

export async function listTagGiven(tagId: string): Promise<TagGiven[]> {
  const [rows] = await pool.query<TagGivenRow[]>(
    `SELECT g.dispatch_id, g.quantity, d.invoice_no, d.customer_name, d.given_date
     FROM dispatch_tags g
     JOIN dispatches d ON d.id = g.dispatch_id
     WHERE g.tag_id = ?
     ORDER BY d.given_date DESC, d.created_at DESC`,
    [tagId],
  );
  return rows.map((r) => ({
    dispatchId: r.dispatch_id,
    invoiceNo: r.invoice_no,
    customerName: r.customer_name,
    givenDate: r.given_date,
    quantity: r.quantity,
  }));
}
