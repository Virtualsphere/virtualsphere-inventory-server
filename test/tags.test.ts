/**
 * Tags: stock by quantity only. Creating with opening stock, adding stock,
 * giving tags alone or with modules on one hand-over, refusing more than is
 * in stock, undo putting tags back, and tag categories (RS232 cables… given
 * the same way). Needs TEST_DB_NAME; wipes dispatches/tags/tag
 * categories/products/modules/units there.
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
  let categories: typeof import("../src/modules/tags/category.service");
  let svc: typeof import("../src/modules/dispatches/dispatch.service");
  let schema: typeof import("../src/modules/dispatches/dispatch.schema");
  let moduleId: string;
  let tagId: string;
  let categoryId: string;

  beforeAll(async () => {
    const { runMigrations } = await import("../src/db/migrate");
    await runMigrations(() => {});

    ({ pool } = await import("../src/db/pool"));
    tags = await import("../src/modules/tags/tag.service");
    tagSchema = await import("../src/modules/tags/tag.schema");
    categories = await import("../src/modules/tags/category.service");
    svc = await import("../src/modules/dispatches/dispatch.service");
    schema = await import("../src/modules/dispatches/dispatch.schema");
    const units = await import("../src/modules/units/unit.service");
    const unitSchema = await import("../src/modules/units/unit.schema");

    await pool.query("DELETE FROM dispatches");
    await pool.query("DELETE FROM tags");
    await pool.query("DELETE FROM tag_categories");
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
    categoryId = (await categories.createCategory({ name: "Tag" })).id;
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
  const newTag = (body: Record<string, unknown>, category = categoryId) =>
    tags.createTag(tagSchema.createTagSchema.parse({ categoryId: category, ...body }), null);

  it("creates a tag with opening stock and adds more", async () => {
    const t = await newTag({ name: "VST-JTL03", quantity: 1000 });
    tagId = t.id;
    expect(t).toMatchObject({ categoryId, categoryName: "Tag", inStock: 1000, totalAdded: 1000, totalGiven: 0 });

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
    await expect(newTag({ name: "vst-jtl03" })).rejects.toMatchObject({ status: 409 });
  });

  it("gives only tags, with no validity date", async () => {
    const d = await give({ tags: [{ tagId, quantity: 200 }] });
    expect(d.items).toEqual([]);
    expect(d.units).toEqual([]);
    expect(d.validUntil).toBeNull();
    expect(d.tags).toMatchObject([
      { tagId, tagName: "VST-JTL03", categoryId, categoryName: "Tag", quantity: 200 },
    ]);
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
    const t = await newTag({ name: "UHF-W1", quantity: 50 });
    const [intake] = (await tags.getTag(t.id)).intakes;
    const after = await tags.deleteTagIntake(t.id, intake!.id);
    expect(after).toMatchObject({ inStock: 0, totalAdded: 0 });
    await tags.deleteTag(t.id);
  });

  describe("categories", () => {
    let cableCat: string;
    let cableId: string;

    it("creates a category; names are unique case-insensitively", async () => {
      const c = await categories.createCategory({ name: "RS232 Cable" });
      cableCat = c.id;
      expect(c).toMatchObject({ name: "RS232 Cable", tagCount: 0 });
      await expect(categories.createCategory({ name: "rs232 cable" })).rejects.toMatchObject({
        status: 409,
      });
    });

    it("requires a category that exists to create a tag", async () => {
      expect(tagSchema.createTagSchema.safeParse({ name: "No cat" }).success).toBe(false);
      await expect(newTag({ name: "Ghost" }, randomUUID())).rejects.toMatchObject({ status: 404 });
    });

    it("stocks and gives an item of another category with tags and a module", async () => {
      const cable = await newTag({ name: "RS232 1.5m", quantity: 20 }, cableCat);
      cableId = cable.id;
      expect(cable).toMatchObject({ categoryName: "RS232 Cable", inStock: 20 });

      const d = await give({
        invoiceNo: "INV-CAT",
        items: [{ moduleId, quantity: 1 }],
        tags: [
          { tagId, quantity: 10 },
          { tagId: cableId, quantity: 2 },
        ],
        validUntil: "2027-10-27",
      });
      // Ordered by category, then name.
      expect(d.tags).toMatchObject([
        { tagId: cableId, categoryName: "RS232 Cable", quantity: 2 },
        { tagId, categoryName: "Tag", quantity: 10 },
      ]);
      expect((await tags.getTag(cableId)).inStock).toBe(18);

      const found = await svc.listDispatchesPaged(
        schema.listDispatchesSchema.parse({ q: "rs232 cable" }),
      );
      expect(found.items.map((r) => r.id)).toContain(d.id);

      const { pdf } = await svc.getDispatchPdf(d.id);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

      await svc.deleteDispatch(d.id);
      expect((await tags.getTag(cableId)).inStock).toBe(20);
    });

    it("moves a tag to another category", async () => {
      const moved = await tags.updateTag(
        cableId,
        tagSchema.updateTagSchema.parse({ categoryId }),
      );
      expect(moved.categoryName).toBe("Tag");
      await tags.updateTag(cableId, tagSchema.updateTagSchema.parse({ categoryId: cableCat }));
    });

    it("renames, and won't delete a category that has items", async () => {
      const renamed = await categories.renameCategory(cableCat, { name: "Cable" });
      expect(renamed).toMatchObject({ name: "Cable", tagCount: 1 });
      expect((await tags.getTag(cableId)).categoryName).toBe("Cable");

      await expect(categories.deleteCategory(cableCat)).rejects.toMatchObject({ status: 409 });
      await tags.deleteTag(cableId);
      await categories.deleteCategory(cableCat);
      expect((await categories.listCategories()).map((c) => c.name)).toEqual(["Tag"]);
    });
  });
});
