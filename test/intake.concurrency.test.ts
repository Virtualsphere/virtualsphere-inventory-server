/**
 * Proves the headline guarantee: concurrent intake on the SAME product never
 * produces duplicate serials, and the per-product counter stays exact.
 *
 * This test DELETES all products and units, so it refuses to run against your
 * normal database. Point it at a throwaway database:
 *
 *   mysql -u root -p -e "CREATE DATABASE stockroom_test; GRANT ALL ON stockroom_test.* TO 'stockroom'@'%';"
 *   TEST_DATABASE_URL=mysql://stockroom:stockroom@localhost:3306/stockroom_test npm test
 *
 * TEST_DATABASE_URL may also be set in .env. Without it the test is skipped.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";

const TEST_URL = process.env.TEST_DATABASE_URL;

// Bind the app's pool to the test database BEFORE importing anything that
// creates it. Dynamic imports below run after this assignment.
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

describe.skipIf(!TEST_URL)("concurrent intake serial allocation", () => {
  let pool: Pool;
  let intake: typeof import("../src/modules/units/unit.service").intake;
  let productId: string;

  beforeAll(async () => {
    const { runMigrations } = await import("../src/db/migrate");
    await runMigrations(TEST_URL!, () => {});

    ({ pool } = await import("../src/db/pool"));
    ({ intake } = await import("../src/modules/units/unit.service"));

    await pool.query("DELETE FROM units");
    await pool.query("DELETE FROM products");

    productId = randomUUID();
    await pool.query(
      `INSERT INTO products (id, name, sku, warranty_months)
       VALUES (?, 'Concurrency Widget', 'CONC1', 12)`,
      [productId],
    );
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it("assigns unique, contiguous serials under parallel intake", async () => {
    const BATCHES = 8;
    const PER_BATCH = 25;
    const EXPECTED = BATCHES * PER_BATCH;

    // Fire all intakes at once — they contend for the same product row.
    const results = await Promise.all(
      Array.from({ length: BATCHES }, () =>
        intake({ productId, quantity: PER_BATCH, notes: "" } as never),
      ),
    );

    const createdTotal = results.reduce((n, r) => n + r.created, 0);
    expect(createdTotal).toBe(EXPECTED);

    // Every seq from 1..EXPECTED appears exactly once.
    const [seqRows] = await pool.query<RowDataPacket[]>(
      "SELECT seq FROM units WHERE product_id = ? ORDER BY seq",
      [productId],
    );
    const seqs = seqRows.map((r) => r["seq"] as number);
    expect(seqs.length).toBe(EXPECTED);
    expect(new Set(seqs).size).toBe(EXPECTED); // no duplicates
    expect(seqs[0]).toBe(1);
    expect(seqs[seqs.length - 1]).toBe(EXPECTED);

    // Internal serials are globally unique.
    const [dupRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM (
         SELECT internal_serial FROM units
         GROUP BY internal_serial HAVING COUNT(*) > 1
       ) d`,
    );
    expect(Number(dupRows[0]!["count"])).toBe(0);

    // The product counter advanced to exactly EXPECTED + 1.
    const [prodRows] = await pool.query<RowDataPacket[]>(
      "SELECT next_seq FROM products WHERE id = ?",
      [productId],
    );
    expect(prodRows[0]!["next_seq"]).toBe(EXPECTED + 1);
  });
});
