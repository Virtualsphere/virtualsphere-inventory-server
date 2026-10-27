/**
 * Tags: stock by quantity only. Creating with opening stock, adding stock,
 * giving tags alone or with modules on one hand-over, refusing more than is
 * in stock, and undo putting tags back. Needs TEST_DB_NAME; wipes
 * dispatches/tags/products/modules/units there.
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

describe.skipIf(!TEST_DB)("tags", () => {
  let pool: Pool;
  let tags: typeof import("../src/modules/tags/tag.service");
  let tagSchema: typeof import("../src/modules/tags/tag.schema");
  let svc: typeof import("../src/modules/dispatches/dispatch.service");
  let schema: typeof import("../src/modules/dispatches/dispatch.schema");
  let moduleId: string;
  let tagId: string;

  beforeAll(async () => {
    const { runMigrations } = await import("../src/db/migrate");
    await runMigrations(() => {});

    ({ pool } = await import("../src/db/pool"));
    tags = await import("../src/modules/tags/tag.service");
    tagSchema = await import("../src/modules/tags/tag.schema");
    svc = await import("../src/modules/dispatches/dispatch.service");
    schema = await import("../src/modules/dispatches/dispatch.schema");
    const units = await import("../src/modules/units/unit.service");
    const unitSchema = await import("../src/modules/units/unit.schema");

    await pool.query("DELETE FROM dispatches");
    await pool.query("DELETE FROM tags");
    await pool.query("DELETE FROM units");
    await pool.query("DELETE FROM modules");
    await pool.query("DELETE FROM products");

    const productId = randomUUID();
    await pool.query("INSERT INTO products (id, name) VALUES (?, 'Tag Product')", [productId]);
    moduleId = randomUUID();
    await pool.query(
      `INSERT INTO modules (id, product_id, name, sku, warranty_months)
       VALUES (?, ?, 'Tag Reader', 'TR1', 12)`,
      [moduleId, productId],
    );
    await units.intake(unitSchema.intakeSchema.parse({ moduleId, quantity: 3 }));
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  const header = {
    invoiceNo: "INV-T",
    customerName: "Mehta Jewellers",
    customerPhone: "9876543210",
    givenDate: "2026-10-27",
  };
  const give = (body: Record<string, unknown>) =>
    svc.createDispatch(schema.createDispatchSchema.parse({ ...header, ...body }), null);
  const stock = async () => (await tags.getTag(tagId)).inStock;

  it("creates a tag with opening stock and adds more", async () => {
    const t = await tags.createTag(
      tagSchema.createTagSchema.parse({ name: "VST-JTL03", quantity: 1000 }),
      null,
    );
    tagId = t.id;
    expect(t).toMatchObject({ inStock: 1000, totalAdded: 1000, totalGiven: 0 });

    const more = await tags.addTagStock(
      tagId,
      tagSchema.addTagStockSchema.parse({ quantity: 500, notes: "PO-1" }),
      null,
    );
    expect(more.inStock).toBe(1500);
    const detail = await tags.getTag(tagId);
    expect(detail.intakes.map((i) => i.quantity).sort()).toEqual([1000, 500].sort());
  });

  it("refuses a duplicate tag name (case-insensitive)", async () => {
    await expect(
      tags.createTag(tagSchema.createTagSchema.parse({ name: "vst-jtl03" }), null),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("gives only tags, with no validity date", async () => {
    const d = await give({ tags: [{ tagId, quantity: 200 }] });
    expect(d.items).toEqual([]);
    expect(d.units).toEqual([]);
    expect(d.validUntil).toBeNull();
    expect(d.tags).toMatchObject([{ tagId, tagName: "VST-JTL03", quantity: 200 }]);
    expect(d.tagQuantity).toBe(200);
    expect(await stock()).toBe(1300);

    const detail = await tags.getTag(tagId);
    expect(detail.totalGiven).toBe(200);
    expect(detail.given).toMatchObject([{ dispatchId: d.id, quantity: 200 }]);

    // No warranty on tags: the PDF is a delivery note.
    const { filename, pdf } = await svc.getDispatchPdf(d.id);
    expect(filename).toBe("delivery-note-INV-T.pdf");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("gives a module and tags on one hand-over, and undo returns both", async () => {
    const d = await give({
      items: [{ moduleId, quantity: 2 }],
      tags: [{ tagId, quantity: 300 }],
      validUntil: "2027-10-27",
    });
    expect(d.quantity).toBe(2);
    expect(d.tagQuantity).toBe(300);
    expect(await stock()).toBe(1000);

    // Found by tag name in the list.
    const found = await svc.listDispatchesPaged(
      schema.listDispatchesSchema.parse({ q: "JTL03" }),
    );
    expect(found.items.map((r) => r.id)).toContain(d.id);

    await svc.deleteDispatch(d.id);
    expect(await stock()).toBe(1300);
  });

  it("refuses more tags than are in stock, and gives nothing", async () => {
    await expect(
      give({ items: [{ moduleId, quantity: 1 }], tags: [{ tagId, quantity: 5000 }] }),
    ).rejects.toThrow(/Only 1300 of tag VST-JTL03 in stock/);
    expect(await stock()).toBe(1300);
    const [rows] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM units WHERE module_id = ? AND status = 'in_stock'",
      [moduleId],
    );
    expect(Number(rows[0].n)).toBe(3);
  });

  it("rejects an empty hand-over and the same tag twice", () => {
    expect(schema.createDispatchSchema.safeParse({ ...header }).success).toBe(false);
    expect(
      schema.createDispatchSchema.safeParse({
        ...header,
        tags: [{ tagId, quantity: 1 }, { tagId, quantity: 2 }],
      }).success,
    ).toBe(false);
  });

  it("never over-gives under concurrent hand-overs", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        give({ invoiceNo: `TC-${i}`, tags: [{ tagId, quantity: 400 }] }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(3); // 1300 / 400
    expect(await stock()).toBe(1300 - ok * 400);
  });

  it("won't undo an intake whose tags were given, or delete a given tag", async () => {
    const detail = await tags.getTag(tagId);
    const opening = detail.intakes.find((i) => i.quantity === 1000)!;
    await expect(tags.deleteTagIntake(tagId, opening.id)).rejects.toMatchObject({ status: 409 });
    await expect(tags.deleteTag(tagId)).rejects.toMatchObject({ status: 409 });
  });

  it("undoes an intake that is still in stock", async () => {
    const t = await tags.createTag(
      tagSchema.createTagSchema.parse({ name: "UHF-W1", quantity: 50 }),
      null,
    );
    const [intake] = (await tags.getTag(t.id)).intakes;
    const after = await tags.deleteTagIntake(t.id, intake!.id);
    expect(after).toMatchObject({ inStock: 0, totalAdded: 0 });
    await tags.deleteTag(t.id);
  });
});
