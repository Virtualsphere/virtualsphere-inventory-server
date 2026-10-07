/**
 * Editable serials: intake overrides for internal serials, generated serials
 * skipping ones already taken by a hand-edited unit, and PATCHing either
 * serial afterwards. Like the concurrency test, this needs TEST_DB_NAME and
 * wipes products/modules/units in that database.
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

describe.skipIf(!TEST_DB)("editable serials", () => {
  let pool: Pool;
  let svc: typeof import("../src/modules/units/unit.service");
  let schema: typeof import("../src/modules/units/unit.schema");
  let moduleId: string;

  beforeAll(async () => {
    const { runMigrations } = await import("../src/db/migrate");
    await runMigrations(() => {});

    ({ pool } = await import("../src/db/pool"));
    svc = await import("../src/modules/units/unit.service");
    schema = await import("../src/modules/units/unit.schema");

    await pool.query("DELETE FROM units");
    await pool.query("DELETE FROM modules");
    await pool.query("DELETE FROM products");

    const productId = randomUUID();
    await pool.query("INSERT INTO products (id, name) VALUES (?, 'Serial Product')", [productId]);
    moduleId = randomUUID();
    await pool.query(
      `INSERT INTO modules (id, product_id, name, sku, warranty_months)
       VALUES (?, ?, 'Serial Widget', 'SW1', 12)`,
      [moduleId, productId],
    );
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  const intake = (body: Record<string, unknown>) =>
    svc.intake(schema.intakeSchema.parse({ moduleId, ...body }));

  it("uses an overridden internal serial and generates the rest", async () => {
    const r = await intake({ quantity: 3, internalSerials: [null, "CUSTOM-1"] });
    expect(r.units.map((u) => u.internalSerial)).toEqual([
      "SW1-00001",
      "CUSTOM-1",
      "SW1-00003",
    ]);
  });

  it("skips a generated serial already taken by a renamed unit", async () => {
    // Rename an existing unit to what the next generated serial would be.
    const [first] = (await intake({ quantity: 1 })).units; // SW1-00004
    await svc.updateUnit(first!.id, { internalSerial: "SW1-00005" });

    const r = await intake({ quantity: 2 });
    expect(r.units.map((u) => u.internalSerial)).toEqual([
      "SW1-00006",
      "SW1-00007",
    ]);
  });

  it("fills in and edits the supplier serial later", async () => {
    const [u] = (await intake({ quantity: 1 })).units;
    expect(u!.manufacturerSerial).toBeNull();
    const updated = await svc.updateUnit(u!.id, { manufacturerSerial: "SNA-9" });
    expect(updated.manufacturerSerial).toBe("SNA-9");
  });

  it("takes supplier serials for some units in quantity mode", async () => {
    const r = await intake({ quantity: 3, manufacturerSerials: ["SNA-1", null] });
    expect(r.units.map((u) => u.manufacturerSerial)).toEqual(["SNA-1", null, null]);
  });

  it("rejects more supplier serials than the quantity", () => {
    expect(() =>
      schema.intakeSchema.parse({ moduleId, quantity: 1, manufacturerSerials: ["A", "B"] }),
    ).toThrow(/More manufacturer serials than the quantity/);
  });

  it("rejects an internal serial that is already in use", async () => {
    await expect(
      intake({ quantity: 1, internalSerials: ["CUSTOM-1"] }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("CUSTOM-1") });
  });

  it("rejects duplicate overrides within a batch", () => {
    expect(() =>
      schema.intakeSchema.parse({
        moduleId,
        quantity: 2,
        internalSerials: ["X-1", "x-1"],
      }),
    ).toThrow(/Duplicate internal serial/);
  });
});
