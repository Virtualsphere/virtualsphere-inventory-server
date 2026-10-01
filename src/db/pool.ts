import mysql, { type Pool, type PoolConnection } from "mysql2/promise";
import { config } from "../config";

export type { Pool, PoolConnection };

/** Anything we can run a query on: the pool or a transaction connection. */
export type Queryable = Pool | PoolConnection;

export const pool: Pool = mysql.createPool({
  uri: config.databaseUrl,
  connectionLimit: config.dbPoolMax,
  waitForConnections: true,
  // Return SQL DATE as the raw 'YYYY-MM-DD' string instead of a JS Date.
  // Date-only values have no time zone; letting the driver build a Date at
  // local midnight and then calling toISOString() would shift the day.
  // DATETIME columns keep their default Date parsing.
  dateStrings: ["DATE"],
  // DATETIME values are stored and read as UTC (see the session time_zone
  // below), so NOW() and JS Dates agree regardless of the server's zone.
  timezone: "Z",
});

// Pin every new session to UTC so NOW()/CURRENT_DATE match `timezone: "Z"`.
pool.pool.on("connection", (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

/**
 * Run `fn` inside a single transaction on one dedicated connection.
 * Commits on success, rolls back on any throw, always releases the connection.
 */
export async function withTransaction<T>(
  fn: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
