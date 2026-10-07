import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db/pool";
import { getSettings } from "../settings/settings.repo";

export interface StatsTotals {
  products: number;
  modules: number;
  units: number;
  inStock: number;
  sold: number;
  returned: number;
  defective: number;
}

/** A module at or below the low-stock threshold. */
export interface LowStockModule {
  id: string;
  name: string;
  sku: string;
  productName: string;
  inStock: number;
}

export interface Stats {
  totals: StatsTotals;
  lowStockThreshold: number;
  lowStock: LowStockModule[];
}

export async function getStats(): Promise<Stats> {
  const settings = await getSettings();

  // SUM() yields DECIMAL (a string in mysql2) and NULL over zero rows, so
  // each conditional count is COALESCEd and CAST to an integer.
  const [totalsRows] = await pool.query<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM products)                                AS products,
       (SELECT COUNT(*) FROM modules)                                 AS modules,
       COUNT(*)                                                       AS units,
       CAST(COALESCE(SUM(status = 'in_stock'), 0)  AS SIGNED)         AS in_stock,
       CAST(COALESCE(SUM(status = 'sold'), 0)      AS SIGNED)         AS sold,
       CAST(COALESCE(SUM(status = 'returned'), 0)  AS SIGNED)         AS returned,
       CAST(COALESCE(SUM(status = 'defective'), 0) AS SIGNED)         AS defective
     FROM units`,
  );
  const t = totalsRows[0] as {
    products: number;
    modules: number;
    units: number;
    in_stock: number;
    sold: number;
    returned: number;
    defective: number;
  };

  const [lowRows] = await pool.query<RowDataPacket[]>(
    `SELECT m.id, m.name, m.sku, p.name AS product_name,
            CAST(COALESCE(SUM(u.status = 'in_stock'), 0) AS SIGNED) AS in_stock
     FROM modules m
     JOIN products p ON p.id = m.product_id
     LEFT JOIN units u ON u.module_id = m.id
     GROUP BY m.id
     HAVING in_stock <= ?
     ORDER BY in_stock ASC, p.name ASC, m.name ASC
     LIMIT 50`,
    [settings.lowStockThreshold],
  );
  const low = lowRows as Array<{
    id: string;
    name: string;
    sku: string;
    product_name: string;
    in_stock: number;
  }>;

  return {
    totals: {
      products: t.products,
      modules: t.modules,
      units: t.units,
      inStock: t.in_stock,
      sold: t.sold,
      returned: t.returned,
      defective: t.defective,
    },
    lowStockThreshold: settings.lowStockThreshold,
    lowStock: low.map((r) => ({
      id: r.id,
      name: r.name,
      sku: r.sku,
      productName: r.product_name,
      inStock: r.in_stock,
    })),
  };
}
