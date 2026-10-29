import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool, type Queryable } from "../../db/pool";
import type {
  DispatchResource,
  Resource,
  ResourceUsage,
  StockIntake,
  UnitResource,
} from "../../types";

interface ResourceRow extends RowDataPacket {
  id: string;
  name: string;
  description: string;
  in_stock: number;
  total_added: number;
  total_used: number;
  created_at: Date;
  updated_at: Date;
}

function mapResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    inStock: row.in_stock,
    totalAdded: row.total_added,
    totalUsed: row.total_used,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// SUM() yields DECIMAL (a string in mysql2), hence the CAST.
const SELECT_SQL = `
  SELECT r.*,
         CAST((SELECT COALESCE(SUM(i.quantity), 0) FROM resource_intakes i WHERE i.resource_id = r.id) AS SIGNED)
           AS total_added,
         CAST((SELECT COALESCE(SUM(u.quantity), 0) FROM unit_resources u WHERE u.resource_id = r.id) AS SIGNED)
           AS total_used
  FROM resources r`;

export async function listResourceRows(): Promise<Resource[]> {
  const [rows] = await pool.query<ResourceRow[]>(`${SELECT_SQL} ORDER BY r.name ASC`);
  return rows.map(mapResource);
}

export async function findResourceById(
  id: string,
  conn: Queryable = pool,
): Promise<Resource | null> {
  const [rows] = await conn.query<ResourceRow[]>(`${SELECT_SQL} WHERE r.id = ?`, [id]);
  return rows[0] ? mapResource(rows[0]) : null;
}

export async function insertResource(
  conn: Queryable,
  data: { name: string; description: string; inStock: number },
): Promise<string> {
  // MySQL has no RETURNING: generate the id here.
  const id = randomUUID();
  await conn.query(
    "INSERT INTO resources (id, name, description, in_stock) VALUES (?, ?, ?, ?)",
    [id, data.name, data.description, data.inStock],
  );
  return id;
}

export async function updateResourceRow(
  id: string,
  columns: Record<string, unknown>,
): Promise<boolean> {
  const keys = Object.keys(columns);
  if (keys.length === 0) return false;
  const setSql = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => columns[k]);
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE resources SET ${setSql}, updated_at = NOW(3) WHERE id = ?`,
    [...values, id],
  );
  return res.affectedRows > 0;
}

export async function deleteResourceRow(id: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>("DELETE FROM resources WHERE id = ?", [id]);
  return res.affectedRows > 0;
}

/**
 * Move a resource's stock by `delta` (negative takes stock out). Refuses —
 * returns false — when the resource is missing or would drop below zero.
 */
export async function changeResourceStock(
  conn: Queryable,
  id: string,
  delta: number,
): Promise<boolean> {
  const [res] = await conn.query<ResultSetHeader>(
    `UPDATE resources SET in_stock = in_stock + ?, updated_at = NOW(3)
     WHERE id = ? AND in_stock + ? >= 0`,
    [delta, id, delta],
  );
  return res.affectedRows > 0;
}

export interface LockedResourceRow extends RowDataPacket {
  id: string;
  name: string;
  in_stock: number;
}

/** Lock resources in id order (so concurrent movers can't deadlock). */
export async function lockResources(
  conn: Queryable,
  ids: string[],
): Promise<LockedResourceRow[]> {
  if (ids.length === 0) return [];
  const [rows] = await conn.query<LockedResourceRow[]>(
    "SELECT id, name, in_stock FROM resources WHERE id IN (?) ORDER BY id FOR UPDATE",
    [[...ids].sort()],
  );
  return rows;
}

export async function insertResourceIntake(
  conn: Queryable,
  data: {
    resourceId: string;
    quantity: number;
    intakeDate: string;
    notes: string;
    createdBy: string | null;
  },
): Promise<void> {
  await conn.query(
    `INSERT INTO resource_intakes (id, resource_id, quantity, intake_date, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), data.resourceId, data.quantity, data.intakeDate, data.notes, data.createdBy],
  );
}

interface IntakeRow extends RowDataPacket {
  id: string;
  quantity: number;
  intake_date: string;
  notes: string;
  created_by_name: string | null;
  created_at: Date;
}

export async function listResourceIntakes(resourceId: string): Promise<StockIntake[]> {
  const [rows] = await pool.query<IntakeRow[]>(
    `SELECT i.id, i.quantity, i.intake_date, i.notes, i.created_at,
            COALESCE(NULLIF(us.full_name, ''), us.username) AS created_by_name
     FROM resource_intakes i
     LEFT JOIN users us ON us.id = i.created_by
     WHERE i.resource_id = ?
     ORDER BY i.intake_date DESC, i.created_at DESC`,
    [resourceId],
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

/** Lock one intake of `resourceId` for undo; null when there is none. */
export async function lockResourceIntake(
  conn: Queryable,
  resourceId: string,
  intakeId: string,
): Promise<{ quantity: number } | null> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT quantity FROM resource_intakes WHERE id = ? AND resource_id = ? FOR UPDATE",
    [intakeId, resourceId],
  );
  return rows[0] ? { quantity: Number(rows[0]["quantity"]) } : null;
}

export async function deleteResourceIntakeRow(conn: Queryable, intakeId: string): Promise<void> {
  await conn.query("DELETE FROM resource_intakes WHERE id = ?", [intakeId]);
}

interface UsageRow extends RowDataPacket {
  module_id: string;
  module_name: string;
  module_sku: string;
  product_name: string;
  units: number;
  quantity: number;
}

/** How much of a resource each module's units used. */
export async function listResourceUsage(resourceId: string): Promise<ResourceUsage[]> {
  const [rows] = await pool.query<UsageRow[]>(
    `SELECT m.id AS module_id, m.name AS module_name, m.sku AS module_sku,
            p.name AS product_name,
            COUNT(*) AS units,
            CAST(SUM(ur.quantity) AS SIGNED) AS quantity
     FROM unit_resources ur
     JOIN units u ON u.id = ur.unit_id
     JOIN modules m ON m.id = u.module_id
     JOIN products p ON p.id = m.product_id
     WHERE ur.resource_id = ?
     GROUP BY m.id
     ORDER BY p.name ASC, m.name ASC`,
    [resourceId],
  );
  return rows.map((r) => ({
    moduleId: r.module_id,
    moduleName: r.module_name,
    sku: r.module_sku,
    productName: r.product_name,
    units: r.units,
    quantity: r.quantity,
  }));
}

/**
 * The resources in a hand-over's units, totalled per module line — counting
 * the units still linked to it, like its serial list.
 */
export async function listDispatchResources(dispatchId: string): Promise<DispatchResource[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.module_id, ur.resource_id, r.name AS resource_name,
            COUNT(*) AS units,
            CAST(SUM(ur.quantity) AS SIGNED) AS quantity
     FROM units u
     JOIN unit_resources ur ON ur.unit_id = u.id
     JOIN resources r ON r.id = ur.resource_id
     WHERE u.dispatch_id = ?
     GROUP BY u.module_id, ur.resource_id
     ORDER BY r.name ASC`,
    [dispatchId],
  );
  return rows.map((r) => ({
    moduleId: String(r["module_id"]),
    resourceId: String(r["resource_id"]),
    resourceName: String(r["resource_name"]),
    units: Number(r["units"]),
    quantity: Number(r["quantity"]),
  }));
}

// --- per-unit usage --------------------------------------------------------

interface UnitResourceRow extends RowDataPacket {
  resource_id: string;
  resource_name: string;
  quantity: number;
}

export async function listUnitResources(
  conn: Queryable,
  unitId: string,
): Promise<UnitResource[]> {
  const [rows] = await conn.query<UnitResourceRow[]>(
    `SELECT ur.resource_id, ur.quantity, r.name AS resource_name
     FROM unit_resources ur
     JOIN resources r ON r.id = ur.resource_id
     WHERE ur.unit_id = ?
     ORDER BY r.name ASC`,
    [unitId],
  );
  return rows.map((r) => ({
    resourceId: r.resource_id,
    resourceName: r.resource_name,
    quantity: r.quantity,
  }));
}

/** Record `lines` (per-unit quantities) against every unit in `unitIds`. */
export async function insertUnitResources(
  conn: Queryable,
  unitIds: string[],
  lines: Array<{ resourceId: string; quantity: number }>,
): Promise<void> {
  if (unitIds.length === 0 || lines.length === 0) return;
  const values = unitIds.flatMap((u) => lines.map((l) => [u, l.resourceId, l.quantity]));
  await conn.query("INSERT INTO unit_resources (unit_id, resource_id, quantity) VALUES ?", [
    values,
  ]);
}

export async function deleteUnitResourceRows(conn: Queryable, unitId: string): Promise<void> {
  await conn.query("DELETE FROM unit_resources WHERE unit_id = ?", [unitId]);
}

/**
 * Total resources used by a module's units that were never given out — what
 * deleting the module hands back to stock.
 */
export async function moduleResourceTotals(
  conn: Queryable,
  moduleId: string,
): Promise<Array<{ resourceId: string; quantity: number }>> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT ur.resource_id, CAST(SUM(ur.quantity) AS SIGNED) AS quantity
     FROM unit_resources ur
     JOIN units u ON u.id = ur.unit_id
     WHERE u.module_id = ? AND u.dispatch_id IS NULL
     GROUP BY ur.resource_id`,
    [moduleId],
  );
  return rows.map((r) => ({
    resourceId: String(r["resource_id"]),
    quantity: Number(r["quantity"]),
  }));
}
