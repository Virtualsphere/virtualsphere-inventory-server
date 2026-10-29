/**
 * Antennas: products of kind "antenna" whose models are stocked exactly like
 * modules — serials, warranty, resources — and given on the same hand-over as
 * modules and tags. Kept apart from modules in lists and stats. Needs
 * TEST_DB_NAME; wipes dispatches/tags/resources/products/modules/units there.
 */
import "dotenv/config";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";

const TEST_DB = process.env.TEST_DB_NAME;

if (TEST_DB) {
  process.env.DB_NAME = TEST_DB;
  delete process.env.DATABASE_URL;
}

describe.skipIf(!TEST_DB)("antennas", () => {
  let pool: Pool;
  let products: typeof import("../src/modules/products/product.service");
  let productSchema: typeof import("../src/modules/products/product.schema");
  let modules: typeof import("../src/modules/modules/module.service");
  let units: typeof import("../src/modules/units/unit.service");
  let unitSchema: typeof import("../src/modules/units/unit.schema");
  let svc: typeof import("../src/modules/dispatches/dispatch.service");
  let schema: typeof import("../src/modules/dispatches/dispatch.schema");
  let antennaId: string;
  let moduleId: string;
  let resourceId: string;

  beforeAll(async () => {
    const { runMigrations } = await import("../src/db/migrate");
    await runMigrations(() => {});

    ({ pool } = await import("../src/db/pool"));
    products = await import("../src/modules/products/product.service");
    productSchema = await import("../src/modules/products/product.schema");
    modules = await import("../src/modules/modules/module.service");
    units = await import("../src/modules/units/unit.service");
    unitSchema = await import("../src/modules/units/unit.schema");
    svc = await import("../src/modules/dispatches/dispatch.service");
    schema = await import("../src/modules/dispatches/dispatch.schema");
    const res = await import("../src/modules/resources/resource.service");
    const resSchema = await import("../src/modules/resources/resource.schema");

    await pool.query("DELETE FROM dispatches");
    await pool.query("DELETE FROM tags");
    await pool.query("DELETE FROM units");
    await pool.query("DELETE FROM modules");
    await pool.query("DELETE FROM products");
    await pool.query("DELETE FROM resources");

    const reader = await products.createProduct(
      productSchema.createProductSchema.parse({ name: "UHF Reader" }),
    );
    moduleId = (await modules.createModule({
      productId: reader.id, name: "Reader board", sku: "UR-1", description: "", warrantyMonths: 12,
    })).id;
    await units.intake(unitSchema.intakeSchema.parse({ moduleId, quantity: 2 }));

    resourceId = (await res.createResource(
      resSchema.createResourceSchema.parse({ name: "SMA connector", quantity: 10 }),
      null,
    )).id;
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it("creates an antenna product; products default to modules", async () => {
    const p = await products.createProduct(
      productSchema.createProductSchema.parse({ kind: "antenna", name: "UHF Antennas" }),
    );
    expect(p.kind).toBe("antenna");
    expect(productSchema.createProductSchema.parse({ name: "X" }).kind).toBe("module");
    expect(productSchema.createProductSchema.safeParse({ name: "X", kind: "cable" }).success).toBe(false);

    const a = await modules.createModule({
      productId: p.id, name: "9 dBi circular", sku: "ANT-9C", description: "", warrantyMonths: 24,
    });
    antennaId = a.id;
    expect(a.kind).toBe("antenna");
  });

  it("lists products and models by kind", async () => {
    expect((await products.listProducts("antenna")).map((p) => p.name)).toEqual(["UHF Antennas"]);
    expect((await products.listProducts("module")).map((p) => p.name)).toEqual(["UHF Reader"]);
    expect((await modules.listModules({ kind: "antenna" })).map((m) => m.id)).toEqual([antennaId]);
    expect((await modules.listModules()).length).toBe(2);
  });

  it("adds antenna stock with supplier serials and resources, like a module", async () => {
    const r = await units.intake(
      unitSchema.intakeSchema.parse({
        moduleId: antennaId,
        manufacturerSerials: ["A-001", "A-002", "A-003"],
        resources: [{ resourceId, quantity: 1 }],
      }),
    );
    expect(r.created).toBe(3);
    expect(r.units.every((u) => u.kind === "antenna" && u.warrantyMonths === 24)).toBe(true);
    const [rows] = await pool.query<any[]>("SELECT in_stock FROM resources WHERE id = ?", [resourceId]);
    expect(rows[0].in_stock).toBe(7);
  });

  it("gives an antenna with a module on one hand-over, with a PDF table each", async () => {
    const d = await svc.createDispatch(
      schema.createDispatchSchema.parse({
        invoiceNo: "INV-ANT",
        customerName: "Rao Retail",
        customerPhone: "9876543210",
        givenDate: "2026-10-29",
        validUntil: "2028-10-29",
        items: [
          { moduleId, quantity: 1 },
          { moduleId: antennaId, quantity: 2 },
        ],
      }),
      null,
    );
    expect(d.items.map((i) => [i.moduleName, i.kind]).sort()).toEqual([
      ["9 dBi circular", "antenna"],
      ["Reader board", "module"],
    ]);
    expect(d.units.filter((u) => u.kind === "antenna")).toHaveLength(2);
    // The given antennas' resources, totalled for their line.
    expect(d.resources).toEqual([
      { moduleId: antennaId, resourceId, resourceName: "SMA connector", units: 2, quantity: 2 },
    ]);

    const { filename, pdf } = await svc.getDispatchPdf(d.id);
    expect(filename).toBe("warranty-card-INV-ANT.pdf");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    await svc.deleteDispatch(d.id);
    expect((await modules.getModule(antennaId)).inStock).toBe(3);
  });

  it("counts antennas apart from modules in stats", async () => {
    const { getStats } = await import("../src/modules/stats/stats.repo");
    const s = await getStats();
    expect(s.totals).toMatchObject({ products: 1, modules: 1, antennas: 1 });
  });
});
