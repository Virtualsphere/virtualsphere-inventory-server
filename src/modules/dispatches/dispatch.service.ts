import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { type PoolConnection, withTransaction } from "../../db/pool";
import { conflict, notFound } from "../../lib/errors";
import type { DispatchDetail } from "../../types";
import { getSettings } from "../settings/settings.repo";
import { listUnitsByDispatch } from "../units/unit.repo";
import { buildDispatchPdf } from "./dispatch.pdf";
import {
  findDispatchById,
  insertDispatch,
  insertDispatchItem,
  listDispatches,
  type ListDispatchesResult,
} from "./dispatch.repo";
import type {
  CreateDispatchInput,
  DispatchItemInput,
  ListDispatchesInput,
} from "./dispatch.schema";

interface LockedUnitRow extends RowDataPacket {
  id: string;
  module_id: string;
  internal_serial: string;
  status: string;
}

interface LockedModuleRow extends RowDataPacket {
  id: string;
  name: string;
}

/**
 * GIVE STOCK — one hand-over record (invoice, customer, dates) with a line per
 * module, all written in one transaction, so either all of it goes out or
 * none does. All the modules involved are
 * locked first (FOR UPDATE, in id order so two hand-overs sharing modules
 * can't deadlock), which serializes dispatches of the same module; then each
 * line's units are locked and checked to be in stock. The final UPDATE per
 * line still re-checks `status = 'in_stock'` and the row count, so a unit can
 * never be given out twice.
 */
export async function createDispatch(
  input: CreateDispatchInput,
  createdBy: string | null,
): Promise<DispatchDetail> {
  const id = await withTransaction(async (conn) => {
    const moduleIds = [...new Set(input.items.map((i) => i.moduleId))].sort();
    const [locked] = await conn.query<LockedModuleRow[]>(
      "SELECT id, name FROM modules WHERE id IN (?) ORDER BY id FOR UPDATE",
      [moduleIds],
    );
    if (locked.length !== moduleIds.length) throw notFound("Module");
    const moduleName = new Map(locked.map((m) => [m.id, m.name]));

    const dispatchId = randomUUID();
    await insertDispatch(conn, {
      id: dispatchId,
      invoiceNo: input.invoiceNo,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      gstNo: input.gstNo,
      givenDate: input.givenDate,
      validUntil: input.validUntil,
      notes: input.notes,
      createdBy,
    });
    for (const item of input.items) {
      await giveItem(conn, dispatchId, input, item, moduleName.get(item.moduleId)!);
    }
    return dispatchId;
  });

  return getDispatch(id);
}

/** One line of a hand-over, inside createDispatch's transaction. */
async function giveItem(
  conn: PoolConnection,
  dispatchId: string,
  input: CreateDispatchInput,
  item: DispatchItemInput,
  moduleName: string,
): Promise<void> {
  let unitIds: string[];
  if (item.unitIds) {
    const [rows] = await conn.query<LockedUnitRow[]>(
      `SELECT id, module_id, internal_serial, status
       FROM units WHERE id IN (?) FOR UPDATE`,
      [item.unitIds],
    );
    if (rows.length !== item.unitIds.length) throw notFound("Unit");
    if (rows.some((r) => r.module_id !== item.moduleId)) {
      throw conflict(`Some units selected for ${moduleName} belong to a different module`);
    }
    const unavailable = rows.filter((r) => r.status !== "in_stock");
    if (unavailable.length) {
      throw conflict(
        `Not in stock: ${unavailable.map((r) => r.internal_serial).join(", ")}`,
      );
    }
    unitIds = item.unitIds;
  } else {
    const qty = item.quantity!;
    const [rows] = await conn.query<LockedUnitRow[]>(
      `SELECT id FROM units
       WHERE module_id = ? AND status = 'in_stock'
       ORDER BY seq ASC
       LIMIT ? FOR UPDATE`,
      [item.moduleId, qty],
    );
    if (rows.length < qty) {
      throw conflict(
        `Only ${rows.length} unit${rows.length === 1 ? "" : "s"} of ${moduleName} in stock`,
      );
    }
    unitIds = rows.map((r) => r.id);
  }

  await insertDispatchItem(conn, dispatchId, item.moduleId, unitIds.length);

  const [res] = await conn.query<ResultSetHeader>(
    `UPDATE units
     SET status = 'sold', sold_to = ?, sold_date = ?, dispatch_id = ?, updated_at = NOW(3)
     WHERE id IN (?) AND status = 'in_stock'`,
    [input.customerName, input.givenDate, dispatchId, unitIds],
  );
  if (res.affectedRows !== unitIds.length) {
    throw conflict("Some units were given out by someone else — please retry");
  }
}

export function listDispatchesPaged(
  input: ListDispatchesInput,
): Promise<ListDispatchesResult> {
  return listDispatches(input);
}

export async function getDispatch(id: string): Promise<DispatchDetail> {
  const dispatch = await findDispatchById(id);
  if (!dispatch) throw notFound("Dispatch");
  return { ...dispatch, units: await listUnitsByDispatch(id) };
}

/** The warranty card PDF for one hand-over, with a filename safe for a header. */
export async function getDispatchPdf(
  id: string,
): Promise<{ filename: string; pdf: Buffer }> {
  const [dispatch, settings] = await Promise.all([getDispatch(id), getSettings()]);
  const safe = dispatch.invoiceNo.replace(/[^A-Za-z0-9._-]+/g, "_");
  return {
    filename: `warranty-card-${safe}.pdf`,
    pdf: await buildDispatchPdf(dispatch, settings),
  };
}

/**
 * Undo a hand-over entered by mistake: units still marked sold (from every
 * line) go back in stock, and the record and its lines are deleted. Units since marked returned/defective
 * keep their status (their link to the record is cleared by the FK).
 */
export async function deleteDispatch(id: string): Promise<void> {
  await withTransaction(async (conn) => {
    const existing = await findDispatchById(id, conn);
    if (!existing) throw notFound("Dispatch");
    await conn.query(
      `UPDATE units
       SET status = 'in_stock', sold_to = NULL, sold_date = NULL,
           dispatch_id = NULL, updated_at = NOW(3)
       WHERE dispatch_id = ? AND status = 'sold'`,
      [id],
    );
    await conn.query("DELETE FROM dispatches WHERE id = ?", [id]);
  });
}
