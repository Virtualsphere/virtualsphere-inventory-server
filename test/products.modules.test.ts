/**
 * Product -> module -> unit hierarchy: modules hang off a product, stock
 * counts roll up from modules to their product, a module can move to another
 * product, and a product can't be deleted while it still has modules.
 * Needs TEST_DB_NAME; wipes products/modules/units there.
 */
import "dotenv/config";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";

const TEST_DB = process.env.TEST_DB_NAME;

if (TEST_DB) {
  process.env.DB_NAME = TEST_DB;
  delete process.env.DATABASE_URL;
}

describe.skipIf(!TEST_DB)("products and modules", () => {
  let pool: Pool;
  let products: typeof import("../src/modules/products/product.service");
  let modules: typeof import("../src/modules/modules/module.service");
  let units: typeof import("../src/modules/units/unit.service");
  let unitSchema: typeof import("../src/modules/units/unit.schema");

  beforeAll(async () => {
    const { runMigrations } = await import("../src/db/migrate");
    await runMigrations(() => {});

    ({ pool } = await import("../src/db/pool"));
    products = await import("../src/modules/products/product.service");
    modules = await import("../src/modules/modules/module.service");
    units = await import("../src/modules/units/unit.service");
    unitSchema = await import("../src/modules/units/unit.schema");

    await pool.query("DELETE FROM dispatches");
    await pool.query("DELETE FROM units");
    await pool.query("DELETE FROM modules");
    await pool.query("DELETE FROM products");
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  const newModule = (productId: string, name: string, sku: string) =>
    modules.createModule({ productId, name, sku, description: "" });

  it("attaches several modules to one product and rolls stock up to it", async () => {
    const p = await products.createProduct({ name: "Reader Kit", description: "" });
    const a = await newModule(p.id, "Antenna", "RK-ANT");
    const b = await newModule(p.id, "Controller", "RK-CTL");
    expect(a.productName).toBe("Reader Kit");

    await units.intake(unitSchema.intakeSchema.parse({ moduleId: a.id, quantity: 3 }));
    await units.intake(unitSchema.intakeSchema.parse({ moduleId: b.id, quantity: 2 }));

    const withCounts = await products.getProduct(p.id);
    expect(withCounts).toMatchObject({ moduleCount: 2, totalUnits: 5, inStock: 5 });

    const list = await modules.listModules(p.id);
    expect(list.map((m) => [m.name, m.inStock])).toEqual([
      ["Antenna", 3],
      ["Controller", 2],
    ]);

    const view = await units.listUnitsPaged(
      unitSchema.listUnitsSchema.parse({ productId: p.id, sort: "serial" }),
    );
    expect(view.total).toBe(5);
    expect(view.items[0]).toMatchObject({
      productName: "Reader Kit",
      moduleName: "Antenna",
      sku: "RK-ANT",
    });
  });

  it("counts an empty product as zero", async () => {
    const p = await products.createProduct({ name: "Empty Kit", description: "" });
    expect(await products.getProduct(p.id)).toMatchObject({
      moduleCount: 0,
      totalUnits: 0,
      inStock: 0,
    });
  });

  it("rejects a duplicate product name, case-insensitively", async () => {
    await expect(
      products.createProduct({ name: "reader kit", description: "" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a module for an unknown product", async () => {
    await expect(
      newModule("00000000-0000-4000-8000-000000000000", "Ghost", "GHOST"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("moves a module, with its stock, to another product", async () => {
    const from = await products.createProduct({ name: "Old Kit", description: "" });
    const to = await products.createProduct({ name: "New Kit", description: "" });
    const m = await newModule(from.id, "Sensor", "SENS-1");
    await units.intake(unitSchema.intakeSchema.parse({ moduleId: m.id, quantity: 4 }));

    const moved = await modules.updateModule(m.id, { productId: to.id });
    expect(moved.productName).toBe("New Kit");
    expect((await products.getProduct(to.id)).inStock).toBe(4);
    expect((await products.getProduct(from.id)).inStock).toBe(0);
  });

  it("won't delete a product that still has modules", async () => {
    const p = await products.createProduct({ name: "Busy Kit", description: "" });
    const m = await newModule(p.id, "Board", "BUSY-1");
    await expect(products.deleteProduct(p.id)).rejects.toMatchObject({ status: 409 });

    await modules.deleteModule(m.id);
    await products.deleteProduct(p.id);
    await expect(products.getProduct(p.id)).rejects.toMatchObject({ status: 404 });
  });
});
