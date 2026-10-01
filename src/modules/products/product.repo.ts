import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../../db/pool";
import type { Product, ProductWithCounts } from "../../types";

interface ProductRow extends RowDataPacket {
  id: string;
  name: string;
  sku: string;
  description: string;
  warranty_months: number;
  serial_prefix: string | null;
  next_seq: number;
  created_at: Date;
  updated_at: Date;
}

type ProductCountRow = ProductRow & {
  total_units: number;
  in_stock: number;
};

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
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

function mapProductWithCounts(row: ProductCountRow): ProductWithCounts {
  return {
    ...mapProduct(row),
    totalUnits: row.total_units,
    inStock: row.in_stock,
  };
}

export interface NewProduct {
  name: string;
  sku: string;
  description: string;
  warrantyMonths: number;
  serialPrefix: string | null;
}

export async function insertProduct(data: NewProduct): Promise<Product> {
  // MySQL has no RETURNING: generate the id here, insert, then read it back.
  const id = randomUUID();
  await pool.query(
    `INSERT INTO products (id, name, sku, description, warranty_months, serial_prefix)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, data.name, data.sku, data.description, data.warrantyMonths, data.serialPrefix],
  );
  return (await findProductById(id))!;
}

// SUM() yields DECIMAL (a string in mysql2) and NULL over zero rows, so the
// in-stock count is COALESCEd and CAST to an integer.
const COUNTS_SQL = `
  SELECT p.*,
         COUNT(u.id)                                                     AS total_units,
         CAST(COALESCE(SUM(u.status = 'in_stock'), 0) AS SIGNED)         AS in_stock
  FROM products p
  LEFT JOIN units u ON u.product_id = p.id`;

export async function listProductsWithCounts(): Promise<ProductWithCounts[]> {
  const [rows] = await pool.query<ProductCountRow[]>(
    `${COUNTS_SQL}
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
  );
  return rows.map(mapProductWithCounts);
}

export async function findProductById(id: string): Promise<Product | null> {
  const [rows] = await pool.query<ProductRow[]>(
    "SELECT * FROM products WHERE id = ?",
    [id],
  );
  return rows[0] ? mapProduct(rows[0]) : null;
}

export async function findProductWithCounts(
  id: string,
): Promise<ProductWithCounts | null> {
  const [rows] = await pool.query<ProductCountRow[]>(
    `${COUNTS_SQL}
     WHERE p.id = ?
     GROUP BY p.id`,
    [id],
  );
  return rows[0] ? mapProductWithCounts(rows[0]) : null;
}

export async function updateProductRow(
  id: string,
  columns: Record<string, unknown>,
): Promise<Product | null> {
  const keys = Object.keys(columns);
  const setSql = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => columns[k]);
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE products SET ${setSql}, updated_at = NOW(3) WHERE id = ?`,
    [...values, id],
  );
  if (res.affectedRows === 0) return null;
  return findProductById(id);
}

export async function deleteProductRow(id: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>(
    "DELETE FROM products WHERE id = ?",
    [id],
  );
  return res.affectedRows > 0;
}
