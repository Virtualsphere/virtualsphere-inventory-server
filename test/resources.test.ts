/**
 * Resources: parts units are built from. Intake takes per-unit quantities ×
 * units out of stock (all-or-nothing), editing a unit's resources moves stock
 * by the difference, and deleting units / modules hands unused parts back.
 * Needs TEST_DB_NAME; wipes dispatches/units/modules/products/resources there.
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

describe.skipIf(!TEST_DB)("resources", () => {
  let pool: Pool;
  let res: typeof import("../src/modules/resources/resource.service");
  let resSchema: typeof import("../src/modules/resources/resource.schema");
  let units: typeof import("../src/modules/units/unit.service");
  let unitSchema: typeof import("../src/modules/units/unit.schema");
  let productId: string;
  let moduleId: string;
  let wire: string;
  let antenna: string;

  beforeAll(async () => {
    const { runMigrations } = await import("../src/db/migrate");
    await runMigrations(() => {});

    ({ pool } = await import("../src/db/pool"));
    res = await import("../src/modules/resources/resource.service");
    resSchema = await import("../src/modules/resources/resource.schema");
    units = await import("../src/modules/units/unit.service");
    unitSchema = await import("../src/modules/units/unit.schema");

    await pool.query("DELETE FROM dispatches");
    await pool.query("DELETE FROM units");
    await pool.query("DELETE FROM modules");
    await pool.query("DELETE FROM products");
    await pool.query("DELETE FROM resources");

    productId = randomUUID();
    await pool.query("INSERT INTO products (id, name) VALUES (?, 'Res Product')", [productId]);
    moduleId = randomUUID();
    await pool.query(
      `INSERT INTO modules (id, product_id, name, sku, warranty_months)
       VALUES (?, ?, 'Res Reader', 'RR1', 12)`,
      [moduleId, productId],
    );

    const create = (name: string, quantity: number) =>
      res.createResource(resSchema.createResourceSchema.parse({ name, quantity }), null);
    wire = (await create("Wire", 100)).id;
    antenna = (await create("Antenna", 60)).id;
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  const intake = (body: Record<string, unknown>) =>
    units.intake(unitSchema.intakeSchema.parse({ moduleId, ...body }));
  const stock = async (id: string) => (await res.getResource(id)).inStock;

  it("takes per-unit resources × units out of stock at intake", async () => {
    const r = await intake({
      quantity: 5,
      resources: [
        { resourceId: wire, quantity: 2 },
        { resourceId: antenna, quantity: 1 },
      ],
    });
    expect(r.created).toBe(5);
    expect(await stock(wire)).toBe(90);
    expect(await stock(antenna)).toBe(55);

    const used = await res.getUnitResources(r.units[0]!.id);
    expect(used.map((u) => [u.resourceName, u.quantity])).toEqual([
      ["Antenna", 1],
      ["Wire", 2],
    ]);
    const detail = await res.getResource(wire);
    expect(detail.totalUsed).toBe(10);
    expect(detail.usage).toMatchObject([{ moduleId, units: 5, quantity: 10 }]);
  });

  it("refuses an intake the resources can't cover, and adds no units", async () => {
    const [before] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM units WHERE module_id = ?",
      [moduleId],
    );
    await expect(
      intake({ quantity: 100, resources: [{ resourceId: antenna, quantity: 1 }] }),
    ).rejects.toThrow(/Not enough Antenna: 100 needed, 55 in stock/);
    const [after] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM units WHERE module_id = ?",
      [moduleId],
    );
    expect(after[0].n).toBe(before[0].n);
    expect(await stock(antenna)).toBe(55);
  });

  it("adds forgotten resources to a unit later, moving stock by the difference", async () => {
    const [u] = (await intake({ quantity: 1 })).units;
    await res.setUnitResources(u!.id, [{ resourceId: wire, quantity: 3 }]);
    expect(await stock(wire)).toBe(87);

    // 3 -> 1 wire returns 2; adding an antenna takes 1.
    await res.setUnitResources(u!.id, [
      { resourceId: wire, quantity: 1 },
      { resourceId: antenna, quantity: 1 },
    ]);
    expect(await stock(wire)).toBe(89);
    expect(await stock(antenna)).toBe(54);

    // Deleting the unit hands its parts back.
    await units.deleteUnit(u!.id);
    expect(await stock(wire)).toBe(90);
    expect(await stock(antenna)).toBe(55);
  });

  it("rejects the same resource twice", () => {
    expect(
      resSchema.unitResourcesSchema.safeParse([
        { resourceId: wire, quantity: 1 },
        { resourceId: wire, quantity: 2 },
      ]).success,
    ).toBe(false);
  });

  it("won't delete a resource units use, or undo an intake already used", async () => {
    await expect(res.deleteResource(wire)).rejects.toMatchObject({ status: 409 });
    const [opening] = (await res.getResource(wire)).intakes;
    await expect(res.deleteResourceIntake(wire, opening!.id)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("deleting a module returns the resources of its units", async () => {
    const { deleteModule } = await import("../src/modules/modules/module.service");
    await deleteModule(moduleId);
    expect(await stock(wire)).toBe(100);
    expect(await stock(antenna)).toBe(60);
    // Nothing uses the resource now, so it can go.
    await res.deleteResource(antenna);
  });
});
