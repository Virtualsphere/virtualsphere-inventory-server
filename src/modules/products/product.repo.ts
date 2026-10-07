import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../../db/pool";
import type { Product, ProductWithCounts } from "../../types";

interface ProductRow extends RowDataPacket {
  id: string;
  name: string;
  description: string;
  created_at: Date;
  updated_at: Date;
}

type ProductCountRow = ProductRow & {
  module_count: number;
  total_units: number;
  in_stock: number;
};

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapProductWithCounts(row: ProductCountRow): ProductWithCounts {
  return {
    ...mapProduct(row),
    moduleCount: row.module_count,
    totalUnits: row.total_units,
    inStock: row.in_stock,
  };
}

export interface NewProduct {
  name: string;
  description: string;
}

export async function insertProduct(data: NewProduct): Promise<Product> {
  // MySQL has no RETURNING: generate the id here, insert, then read it back.
  const id = randomUUID();
  await pool.query(
    "INSERT INTO products (id, name, description) VALUES (?, ?, ?)",
    [id, data.name, data.description],
  );
  return (await findProductById(id))!;
}

// Units are counted per module first, so joining modules -> units doesn't
// multiply the module count. SUM() yields DECIMAL (a string in mysql2) and
// NULL over zero rows, hence the COALESCE + CAST.
const COUNTS_SQL = `
  SELECT p.*,
         COUNT(m.id)                                           AS module_count,
         CAST(COALESCE(SUM(mc.total_units), 0) AS SIGNED)      AS total_units,
         CAST(COALESCE(SUM(mc.in_stock), 0) AS SIGNED)         AS in_stock
  FROM products p
  LEFT JOIN modules m ON m.product_id = p.id
  LEFT JOIN (
    SELECT module_id,
           COUNT(*)                AS total_units,
           SUM(status = 'in_stock') AS in_stock
    FROM units
    GROUP BY module_id
  ) mc ON mc.module_id = m.id`;

export async function listProductsWithCounts(): Promise<ProductWithCounts[]> {
  const [rows] = await pool.query<ProductCountRow[]>(
    `${COUNTS_SQL}
     GROUP BY p.id
     ORDER BY p.name ASC`,
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
