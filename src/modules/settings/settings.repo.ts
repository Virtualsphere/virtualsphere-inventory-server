import type { RowDataPacket } from "mysql2/promise";
import { pool, type Queryable } from "../../db/pool";
import type { Settings } from "../../types";
import type { UpdateSettingsInput } from "./settings.schema";

interface SettingsRow extends RowDataPacket {
  company_name: string;
  serial_prefix: string;
  default_warranty_months: number;
  low_stock_threshold: number;
  updated_at: Date;
}

function mapSettings(row: SettingsRow): Settings {
  return {
    companyName: row.company_name,
    serialPrefix: row.serial_prefix,
    defaultWarrantyMonths: row.default_warranty_months,
    lowStockThreshold: row.low_stock_threshold,
    updatedAt: row.updated_at.toISOString(),
  };
}

const DEFAULTS: Settings = {
  companyName: "My Company",
  serialPrefix: "",
  defaultWarrantyMonths: 12,
  lowStockThreshold: 5,
  updatedAt: new Date(0).toISOString(),
};

/** Read the singleton settings row. Accepts a transaction client. */
export async function getSettings(db: Queryable = pool): Promise<Settings> {
  const [rows] = await db.query<SettingsRow[]>(
    "SELECT * FROM settings WHERE id = 1",
  );
  return rows[0] ? mapSettings(rows[0]) : DEFAULTS;
}

export async function updateSettings(
  patch: UpdateSettingsInput,
): Promise<Settings> {
  const columns: Record<string, unknown> = {};
  if (patch.companyName !== undefined) columns["company_name"] = patch.companyName;
  if (patch.serialPrefix !== undefined) columns["serial_prefix"] = patch.serialPrefix;
  if (patch.defaultWarrantyMonths !== undefined)
    columns["default_warranty_months"] = patch.defaultWarrantyMonths;
  if (patch.lowStockThreshold !== undefined)
    columns["low_stock_threshold"] = patch.lowStockThreshold;

  const keys = Object.keys(columns);
  const setSql = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => columns[k]);

  // Make sure the singleton row exists, then apply the patch. (Doing the
  // UPDATE separately guarantees the values land even on a fresh database,
  // which a bare INSERT ... ON DUPLICATE KEY UPDATE would skip on first insert.)
  await pool.query("INSERT IGNORE INTO settings (id) VALUES (1)");
  await pool.query(
    `UPDATE settings SET ${setSql}, updated_at = NOW(3) WHERE id = 1`,
    values,
  );
  return getSettings();
}
