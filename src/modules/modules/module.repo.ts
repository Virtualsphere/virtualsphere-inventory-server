import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool, type Queryable } from "../../db/pool";
import type { Module, ModuleWithCounts, ProductKind } from "../../types";

interface ModuleRow extends RowDataPacket {
  id: string;
  product_id: string;
  product_name: string;
  product_kind: ProductKind;
  name: string;
  sku: string;
  description: string;
  warranty_months: number;
  serial_prefix: string | null;
  next_seq: number;
  created_at: Date;
  updated_at: Date;
}

type ModuleCountRow = ModuleRow & {
  total_units: number;
  in_stock: number;
};

function mapModule(row: ModuleRow): Module {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    kind: row.product_kind,
    name: row.name,
    sku: row.sku,
    description: row.description,
    warrantyMonths: row.warranty_months,
    serialPrefix: row.serial_prefix,
    nextSeq: row.next_seq,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapModuleWithCounts(row: ModuleCountRow): ModuleWithCounts {
  return {
    ...mapModule(row),
    totalUnits: row.total_units,
    inStock: row.in_stock,
  };
}

export interface NewModule {
  productId: string;
  name: string;
  sku: string;
  description: string;
  warrantyMonths: number;
  serialPrefix: string | null;
}

export async function insertModule(data: NewModule): Promise<Module> {
  // MySQL has no RETURNING: generate the id here, insert, then read it back.
  const id = randomUUID();
  await pool.query(
    `INSERT INTO modules (id, product_id, name, sku, description, warranty_months, serial_prefix)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.productId,
      data.name,
      data.sku,
      data.description,
      data.warrantyMonths,
      data.serialPrefix,
    ],
  );
  return (await findModuleById(id))!;
}

const SELECT_SQL = `
  SELECT m.*, p.name AS product_name, p.kind AS product_kind
  FROM modules m
  JOIN products p ON p.id = m.product_id`;

// SUM() yields DECIMAL (a string in mysql2) and NULL over zero rows, so the
// in-stock count is COALESCEd and CAST to an integer.
const COUNTS_SQL = `
  SELECT m.*, p.name AS product_name, p.kind AS product_kind,
         COUNT(u.id)                                                     AS total_units,
         CAST(COALESCE(SUM(u.status = 'in_stock'), 0) AS SIGNED)         AS in_stock
  FROM modules m
  JOIN products p ON p.id = m.product_id
  LEFT JOIN units u ON u.module_id = m.id`;

export async function listModulesWithCounts(
  filter: { productId?: string; kind?: ProductKind } = {},
): Promise<ModuleWithCounts[]> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filter.productId) {
    conds.push("m.product_id = ?");
    params.push(filter.productId);
  }
  if (filter.kind) {
    conds.push("p.kind = ?");
    params.push(filter.kind);
  }
  const [rows] = await pool.query<ModuleCountRow[]>(
    `${COUNTS_SQL}
     ${conds.length ? `WHERE ${conds.join(" AND ")}` : ""}
     GROUP BY m.id
     ORDER BY p.name ASC, m.name ASC`,
    params,
  );
  return rows.map(mapModuleWithCounts);
}

export async function findModuleById(id: string): Promise<Module | null> {
  const [rows] = await pool.query<ModuleRow[]>(
    `${SELECT_SQL} WHERE m.id = ?`,
    [id],
  );
  return rows[0] ? mapModule(rows[0]) : null;
}

export async function findModuleWithCounts(
  id: string,
): Promise<ModuleWithCounts | null> {
  const [rows] = await pool.query<ModuleCountRow[]>(
    `${COUNTS_SQL}
     WHERE m.id = ?
     GROUP BY m.id`,
    [id],
  );
  return rows[0] ? mapModuleWithCounts(rows[0]) : null;
}

/** Apply `columns` to a module; false when it doesn't exist. */
export async function updateModuleRow(
  id: string,
  columns: Record<string, unknown>,
  conn: Queryable = pool,
): Promise<boolean> {
  const keys = Object.keys(columns);
  const setSql = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => columns[k]);
  const [res] = await conn.query<ResultSetHeader>(
    `UPDATE modules SET ${setSql}, updated_at = NOW(3) WHERE id = ?`,
    [...values, id],
  );
  return res.affectedRows > 0;
}

export async function deleteModuleRow(
  id: string,
  conn: Queryable = pool,
): Promise<boolean> {
  const [res] = await conn.query<ResultSetHeader>(
    "DELETE FROM modules WHERE id = ?",
    [id],
  );
  return res.affectedRows > 0;
}
