import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { withTransaction } from "../../db/pool";
import { conflict, notFound } from "../../lib/errors";
import type { DispatchDetail } from "../../types";
import { listUnitsByDispatch } from "../units/unit.repo";
import {
  findDispatchById,
  insertDispatch,
  listDispatches,
  type ListDispatchesResult,
} from "./dispatch.repo";
import type {
  CreateDispatchInput,
  ListDispatchesInput,
} from "./dispatch.schema";

interface LockedUnitRow extends RowDataPacket {
  id: string;
  product_id: string;
  internal_serial: string;
  status: string;
}

/**
 * GIVE STOCK — runs in one transaction. The product row is locked first
 * (FOR UPDATE), which serializes dispatches of the same product, then the
 * chosen units are locked and checked to be in stock. The final UPDATE still
 * re-checks `status = 'in_stock'` and the row count, so a unit can never be
 * given out twice.
 */
export async function createDispatch(
  input: CreateDispatchInput,
  createdBy: string | null,
): Promise<DispatchDetail> {
  const id = await withTransaction(async (conn) => {
    const [products] = await conn.query<RowDataPacket[]>(
      "SELECT id FROM products WHERE id = ? FOR UPDATE",
      [input.productId],
    );
    if (!products[0]) throw notFound("Product");

    let unitIds: string[];
    if (input.unitIds) {
      const [rows] = await conn.query<LockedUnitRow[]>(
        `SELECT id, product_id, internal_serial, status
         FROM units WHERE id IN (?) FOR UPDATE`,
        [input.unitIds],
      );
      if (rows.length !== input.unitIds.length) throw notFound("Unit");
      if (rows.some((r) => r.product_id !== input.productId)) {
        throw conflict("Some selected units belong to a different product");
      }
      const unavailable = rows.filter((r) => r.status !== "in_stock");
      if (unavailable.length) {
        throw conflict(
          `Not in stock: ${unavailable.map((r) => r.internal_serial).join(", ")}`,
        );
      }
      unitIds = input.unitIds;
    } else {
      const qty = input.quantity!;
      const [rows] = await conn.query<LockedUnitRow[]>(
        `SELECT id FROM units
         WHERE product_id = ? AND status = 'in_stock'
         ORDER BY seq ASC
         LIMIT ? FOR UPDATE`,
        [input.productId, qty],
      );
      if (rows.length < qty) {
        throw conflict(
          `Only ${rows.length} unit${rows.length === 1 ? "" : "s"} in stock for this product`,
        );
      }
      unitIds = rows.map((r) => r.id);
    }

    const dispatchId = randomUUID();
    await insertDispatch(conn, {
      id: dispatchId,
      invoiceNo: input.invoiceNo,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      gstNo: input.gstNo,
      productId: input.productId,
      quantity: unitIds.length,
      givenDate: input.givenDate,
      validUntil: input.validUntil,
      notes: input.notes,
      createdBy,
    });

    const [res] = await conn.query<ResultSetHeader>(
      `UPDATE units
       SET status = 'sold', sold_to = ?, sold_date = ?, dispatch_id = ?, updated_at = NOW(3)
       WHERE id IN (?) AND status = 'in_stock'`,
      [input.customerName, input.givenDate, dispatchId, unitIds],
    );
    if (res.affectedRows !== unitIds.length) {
      throw conflict("Some units were given out by someone else — please retry");
    }
    return dispatchId;
  });

  return getDispatch(id);
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

/**
 * Undo a dispatch entered by mistake: units still marked sold go back in
 * stock, and the record is deleted. Units since marked returned/defective
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
