/**
 * Minimal forward-only migration runner — no external dependency.
 *
 * - Reads every *.sql file in /migrations, sorted by filename.
 * - Tracks applied files in a `_migrations` table.
 * - Applies each pending file on a dedicated multi-statement connection.
 *
 * Run with:  npm run migrate
 *
 * Note: MySQL implicitly commits DDL (CREATE/ALTER/DROP), so a migration file
 * cannot be rolled back as a unit the way it can in Postgres. Keep each file
 * idempotent (IF NOT EXISTS, INSERT IGNORE, ...) so a half-applied file can be
 * fixed and simply re-run.
 *
 * For a richer workflow (down migrations, checksums) swap this for
 * Flyway or Knex migrations — the SQL files are compatible.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { config } from "../config";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

/** Apply all pending migrations to the configured database. Returns the files applied. */
export async function runMigrations(
  log: (msg: string) => void = console.log,
): Promise<string[]> {
  // A dedicated connection: migration files contain several statements, which
  // the app pool deliberately does not allow (it's an injection hardening).
  const conn = await mysql.createConnection({
    ...config.db,
    multipleStatements: true,
    timezone: "Z",
  });
  try {
    await conn.query("SET time_zone = '+00:00'");
    await conn.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename    VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT filename FROM _migrations",
    );
    const applied = new Set(rows.map((r) => r["filename"] as string));

    const pending = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => !applied.has(f));

    if (pending.length === 0) {
      log("migrate: nothing to do (database is up to date)");
      return [];
    }

    for (const file of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      try {
        await conn.query(sql);
        await conn.query("INSERT INTO _migrations (filename) VALUES (?)", [
          file,
        ]);
        log(`migrate: applied ${file}`);
      } catch (err) {
        log(`migrate: FAILED on ${file}`);
        throw err;
      }
    }
    log(`migrate: done (${pending.length} applied)`);
    return pending;
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
