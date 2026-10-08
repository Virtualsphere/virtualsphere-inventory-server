/**
 * Giving stock to a customer: units flip to sold and link to the record,
 * out-of-stock picks are refused, concurrent dispatches never share a unit,
 * one hand-over can cover several modules (all-or-nothing), and undo puts
 * units back. Needs TEST_DB_NAME; wipes products/modules/units there.
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
  let moduleId: string;
  let otherModuleId: string;

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
    await pool.query("DELETE FROM modules");
    await pool.query("DELETE FROM products");

    const productId = randomUUID();
    await pool.query("INSERT INTO products (id, name) VALUES (?, 'Give Product')", [productId]);
    moduleId = randomUUID();
    await pool.query(
      `INSERT INTO modules (id, product_id, name, sku, warranty_months)
       VALUES (?, ?, 'Give Widget', 'GW1', 12)`,
      [moduleId, productId],
    );
    await units.intake(unitSchema.intakeSchema.parse({ moduleId, quantity: 10 }));

    otherModuleId = randomUUID();
    await pool.query(
      `INSERT INTO modules (id, product_id, name, sku, warranty_months)
       VALUES (?, ?, 'Give Gadget', 'GG1', 12)`,
      [otherModuleId, productId],
    );
    await units.intake(unitSchema.intakeSchema.parse({ moduleId: otherModuleId, quantity: 5 }));
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  const header = {
    invoiceNo: "INV-1",
    customerName: "Sharma Electronics",
    customerPhone: "9876543210",
    givenDate: "2026-10-06",
  };

  /** Hand over several modules at once; returns the one record with a line per module. */
  const giveMany = (items: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
    svc.createDispatch(
      schema.createDispatchSchema.parse({ ...header, ...extra, items }),
      null,
    );

  /** Hand over one line of the main module; `quantity` / `unitIds` go on the item. */
  const give = ({ quantity, unitIds, ...extra }: Record<string, unknown>) =>
    giveMany([{ moduleId, quantity, unitIds }], extra);

  const inStock = async (id = moduleId) => {
    const [rows] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM units WHERE module_id = ? AND status = 'in_stock'",
      [id],
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
      unitSchema.listUnitsSchema.parse({ moduleId, status: "in_stock", sort: "serial" }),
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
    await expect(give({ quantity: 999 })).rejects.toThrow(/Only \d+ units? of Give Widget in stock/);
  });

  it("rejects a bad GSTIN and a validity date before the given date", () => {
    const base = {
      invoiceNo: "X", customerName: "Y", customerPhone: "9876543210",
      givenDate: "2026-10-06", items: [{ moduleId, quantity: 1 }],
    };
    expect(schema.createDispatchSchema.safeParse({ ...base, gstNo: "123" }).success).toBe(false);
    expect(schema.createDispatchSchema.safeParse({ ...base, validUntil: "2026-01-01" }).success).toBe(false);
    expect(schema.createDispatchSchema.safeParse({ ...base, gstNo: "" }).success).toBe(true);
  });

  it("gives several modules to one customer under one invoice", async () => {
    const before = [await inStock(), await inStock(otherModuleId)];
    const d = await giveMany(
      [{ moduleId, quantity: 1 }, { moduleId: otherModuleId, quantity: 2 }],
      { invoiceNo: "INV-MULTI", gstNo: "27AAPFU0939F1ZV", validUntil: "2027-10-06" },
    );
    expect(d).toMatchObject({
      invoiceNo: "INV-MULTI",
      customerName: "Sharma Electronics",
      gstNo: "27AAPFU0939F1ZV",
      validUntil: "2027-10-06",
      quantity: 3,
    });
    // Lines come back in product, then module, name order.
    expect(d.items.map((i) => [i.moduleName, i.quantity])).toEqual([
      ["Give Gadget", 2],
      ["Give Widget", 1],
    ]);
    expect(d.units).toHaveLength(3);
    expect(d.units.every((u) => u.dispatchId === d.id)).toBe(true);

    // One row in the list, found by either module.
    const byModule = await svc.listDispatchesPaged(
      schema.listDispatchesSchema.parse({ moduleId: otherModuleId, q: "INV-MULTI" }),
    );
    expect(byModule.items.map((r) => r.id)).toEqual([d.id]);
    expect(await inStock()).toBe(before[0]! - 1);
    expect(await inStock(otherModuleId)).toBe(before[1]! - 2);

    // Undo returns every line's units.
    await svc.deleteDispatch(d.id);
    expect([await inStock(), await inStock(otherModuleId)]).toEqual(before);
  });

  it("gives nothing if any line of a hand-over fails", async () => {
    const before = [await inStock(), await inStock(otherModuleId)];
    await expect(
      giveMany([{ moduleId, quantity: 1 }, { moduleId: otherModuleId, quantity: 999 }]),
    ).rejects.toThrow(/Only \d+ units? of Give Gadget in stock/);
    expect([await inStock(), await inStock(otherModuleId)]).toEqual(before);
  });

  it("rejects the same module on two lines and an empty hand-over", () => {
    const twice = schema.createDispatchSchema.safeParse({
      ...header,
      items: [{ moduleId, quantity: 1 }, { moduleId, quantity: 2 }],
    });
    expect(twice.success).toBe(false);
    expect(schema.createDispatchSchema.safeParse({ ...header, items: [] }).success).toBe(false);
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

  it("edits a hand-over's details and its sold units follow", async () => {
    const d = await give({ quantity: 1, gstNo: "27AAPFU0939F1ZV", validUntil: "2027-10-06" });
    const edit = (body: Record<string, unknown>) =>
      svc.updateDispatch(d.id, schema.updateDispatchSchema.parse(body));

    const e = await edit({
      invoiceNo: "INV-FIXED",
      customerName: "Verma Traders",
      customerPhone: "9123456780",
      gstNo: "",
      validUntil: "2028-01-31",
    });
    expect(e).toMatchObject({
      invoiceNo: "INV-FIXED",
      customerName: "Verma Traders",
      customerPhone: "9123456780",
      gstNo: null,
      givenDate: "2026-10-06",
      validUntil: "2028-01-31",
      quantity: 1,
    });
    expect(e.units.every((u) => u.soldTo === "Verma Traders")).toBe(true);

    // Validity is checked against the stored given date too.
    await expect(edit({ validUntil: "2026-01-01" })).rejects.toThrow(/before the given date/);
    expect(schema.updateDispatchSchema.safeParse({}).success).toBe(false);
    expect(schema.updateDispatchSchema.safeParse({ gstNo: "123" }).success).toBe(false);
    // Fields left out are kept.
    expect((await edit({ notes: "fixed typo" })).invoiceNo).toBe("INV-FIXED");
    await svc.deleteDispatch(d.id);
  });

  it("renders a warranty card PDF for a hand-over", async () => {
    const d = await give({ quantity: 1, invoiceNo: "INV/PDF 1" });
    const { filename, pdf } = await svc.getDispatchPdf(d.id);
    expect(filename).toBe("warranty-card-INV_PDF_1.pdf");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5000); // includes the logo image
    await svc.deleteDispatch(d.id);
  });

  it("undo puts sold units back in stock", async () => {
    await pool.query("DELETE FROM dispatches");
    await pool.query(
      "UPDATE units SET status = 'in_stock', sold_to = NULL, sold_date = NULL WHERE module_id = ?",
      [moduleId],
    );
    const d = await give({ quantity: 3 });
    expect(await inStock()).toBe(7);
    await svc.deleteDispatch(d.id);
    expect(await inStock()).toBe(10);
    await expect(svc.getDispatch(d.id)).rejects.toThrow(/not found/);
  });
});
