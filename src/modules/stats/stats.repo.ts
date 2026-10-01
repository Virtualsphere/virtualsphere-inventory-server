import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../db/pool";
import { getSettings } from "../settings/settings.repo";

export interface StatsTotals {
  products: number;
  units: number;
  inStock: number;
  sold: number;
  returned: number;
  defective: number;
}

export interface LowStockProduct {
  id: string;
  name: string;
  sku: string;
  inStock: number;
}

export interface Stats {
  totals: StatsTotals;
  lowStockThreshold: number;
  lowStock: LowStockProduct[];
}

export async function getStats(): Promise<Stats> {
  const settings = await getSettings();

  // SUM() yields DECIMAL (a string in mysql2) and NULL over zero rows, so
  // each conditional count is COALESCEd and CAST to an integer.
  const [totalsRows] = await pool.query<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM products)                                AS products,
       COUNT(*)                                                       AS units,
       CAST(COALESCE(SUM(status = 'in_stock'), 0)  AS SIGNED)         AS in_stock,
       CAST(COALESCE(SUM(status = 'sold'), 0)      AS SIGNED)         AS sold,
       CAST(COALESCE(SUM(status = 'returned'), 0)  AS SIGNED)         AS returned,
       CAST(COALESCE(SUM(status = 'defective'), 0) AS SIGNED)         AS defective
     FROM units`,
  );
  const t = totalsRows[0] as {
    products: number;
    units: number;
    in_stock: number;
    sold: number;
    returned: number;
    defective: number;
  };

  const [lowRows] = await pool.query<RowDataPacket[]>(
    `SELECT p.id, p.name, p.sku,
            CAST(COALESCE(SUM(u.status = 'in_stock'), 0) AS SIGNED) AS in_stock
     FROM products p
     LEFT JOIN units u ON u.product_id = p.id
     GROUP BY p.id
     HAVING in_stock <= ?
     ORDER BY in_stock ASC, p.name ASC
     LIMIT 50`,
    [settings.lowStockThreshold],
  );
  const low = lowRows as Array<{
    id: string;
    name: string;
    sku: string;
    in_stock: number;
  }>;

  return {
    totals: {
      products: t.products,
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
      inStock: r.in_stock,
    })),
  };
}
