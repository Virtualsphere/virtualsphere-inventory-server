/**
 * Giving stock to a customer: units flip to sold and link to the record,
 * out-of-stock picks are refused, concurrent dispatches never share a unit,
 * and undo puts units back. Needs TEST_DB_NAME; wipes products/units there.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";

const TEST_DB = process.env.TEST_DB_NAME;

if (TEST_DB) {
  process.env.DB_NAME = TEST_DB;
  delete process.env.DATABASE_URL;
}

describe.skipIf(!TEST_DB)("give stock (dispatches)", () => {
  let pool: Pool;
  let units: typeof import("../src/modules/units/unit.service");
  let unitSchema: typeof import("../src/modules/units/unit.schema");
  let svc: typeof import("../src/modules/dispatches/dispatch.service");
  let schema: typeof import("../src/modules/dispatches/dispatch.schema");
  let productId: string;

  beforeAll(async () => {
    const { runMigrations } = await import("../src/db/migrate");
    await runMigrations(() => {});

    ({ pool } = await import("../src/db/pool"));
    units = await import("../src/modules/units/unit.service");
    unitSchema = await import("../src/modules/units/unit.schema");
    svc = await import("../src/modules/dispatches/dispatch.service");
    schema = await import("../src/modules/dispatches/dispatch.schema");

    await pool.query("DELETE FROM dispatches");
    await pool.query("DELETE FROM units");
    await pool.query("DELETE FROM products");

    productId = randomUUID();
    await pool.query(
      `INSERT INTO products (id, name, sku, warranty_months)
       VALUES (?, 'Give Widget', 'GW1', 12)`,
      [productId],
    );
    await units.intake(unitSchema.intakeSchema.parse({ productId, quantity: 10 }));
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  const give = (body: Record<string, unknown>) =>
    svc.createDispatch(
      schema.createDispatchSchema.parse({
        invoiceNo: "INV-1",
        customerName: "Sharma Electronics",
        customerPhone: "9876543210",
        givenDate: "2026-10-06",
        productId,
        ...body,
      }),
      null,
    );

  const inStock = async () => {
    const [rows] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM units WHERE product_id = ? AND status = 'in_stock'",
      [productId],
    );
    return Number(rows[0].n);
  };

  it("gives the oldest units by quantity and marks them sold", async () => {
    const d = await give({ quantity: 2, gstNo: "27aapfu0939f1zv", validUntil: "2027-10-06" });
    expect(d.quantity).toBe(2);
    expect(d.gstNo).toBe("27AAPFU0939F1ZV");
    expect(d.units.map((u) => u.internalSerial)).toEqual(["GW1-00001", "GW1-00002"]);
    expect(d.units.every((u) => u.status === "sold" && u.soldTo === "Sharma Electronics")).toBe(true);
    expect(d.units[0]!.soldDate).toBe("2026-10-06");
    expect(await inStock()).toBe(8);
  });

  it("gives specific units picked by id", async () => {
    const list = await units.listUnitsPaged(
      unitSchema.listUnitsSchema.parse({ productId, status: "in_stock", sort: "serial" }),
    );
    const pick = list.items.slice(-2).map((u) => u.id);
    const d = await give({ unitIds: pick });
    expect(d.units.map((u) => u.id).sort()).toEqual([...pick].sort());
    expect(await inStock()).toBe(6);
  });

  it("refuses a unit that is already sold", async () => {
    const d = await give({ quantity: 1 });
    await expect(give({ unitIds: [d.units[0]!.id] })).rejects.toThrow(/Not in stock/);
  });

  it("refuses more than is in stock", async () => {
    await expect(give({ quantity: 999 })).rejects.toThrow(/Only \d+ units? in stock/);
  });

  it("rejects a bad GSTIN and a validity date before the given date", () => {
    const base = {
      invoiceNo: "X", customerName: "Y", customerPhone: "9876543210",
      givenDate: "2026-10-06", productId, quantity: 1,
    };
    expect(schema.createDispatchSchema.safeParse({ ...base, gstNo: "123" }).success).toBe(false);
    expect(schema.createDispatchSchema.safeParse({ ...base, validUntil: "2026-01-01" }).success).toBe(false);
    expect(schema.createDispatchSchema.safeParse({ ...base, gstNo: "" }).success).toBe(true);
  });

  it("never hands the same unit to two concurrent dispatches", async () => {
    const before = await inStock();
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) => give({ quantity: 2, invoiceNo: `C-${i}` })),
    );
    const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof give>>
    >[];
    const ids = ok.flatMap((r) => r.value.units.map((u) => u.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(await inStock()).toBe(before - ids.length);
  });

  it("undo puts sold units back in stock", async () => {
    await pool.query("DELETE FROM dispatches");
    await pool.query(
      "UPDATE units SET status = 'in_stock', sold_to = NULL, sold_date = NULL WHERE product_id = ?",
      [productId],
    );
    const d = await give({ quantity: 3 });
    expect(await inStock()).toBe(7);
    await svc.deleteDispatch(d.id);
    expect(await inStock()).toBe(10);
    await expect(svc.getDispatch(d.id)).rejects.toThrow(/not found/);
  });
});
