import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../../db/pool";
import type { TagCategory } from "../../types";

interface CategoryRow extends RowDataPacket {
  id: string;
  name: string;
  tag_count: number;
  created_at: Date;
  updated_at: Date;
}

function mapCategory(row: CategoryRow): TagCategory {
  return {
    id: row.id,
    name: row.name,
    tagCount: row.tag_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const SELECT_SQL = `
  SELECT c.*,
         CAST((SELECT COUNT(*) FROM tags t WHERE t.category_id = c.id) AS SIGNED) AS tag_count
  FROM tag_categories c`;

export async function listCategoryRows(): Promise<TagCategory[]> {
  const [rows] = await pool.query<CategoryRow[]>(`${SELECT_SQL} ORDER BY c.name ASC`);
  return rows.map(mapCategory);
}

export async function findCategoryById(id: string): Promise<TagCategory | null> {
  const [rows] = await pool.query<CategoryRow[]>(`${SELECT_SQL} WHERE c.id = ?`, [id]);
  return rows[0] ? mapCategory(rows[0]) : null;
}

export async function insertCategory(name: string): Promise<string> {
  const id = randomUUID();
  await pool.query("INSERT INTO tag_categories (id, name) VALUES (?, ?)", [id, name]);
  return id;
}

export async function renameCategoryRow(id: string, name: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE tag_categories SET name = ?, updated_at = NOW(3) WHERE id = ?",
    [name, id],
  );
  return res.affectedRows > 0;
}

export async function deleteCategoryRow(id: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>(
    "DELETE FROM tag_categories WHERE id = ?",
    [id],
  );
  return res.affectedRows > 0;
}
