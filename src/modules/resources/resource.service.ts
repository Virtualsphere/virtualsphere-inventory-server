import { pool, type Queryable, withTransaction } from "../../db/pool";
import { conflict, isUniqueViolation as isUnique, notFound } from "../../lib/errors";
import type { Resource, ResourceDetail, UnitResource } from "../../types";
import { findUnitById } from "../units/unit.repo";
import {
  changeResourceStock,
  deleteResourceIntakeRow,
  deleteResourceRow,
  deleteUnitResourceRows,
  findResourceById,
  insertResource,
  insertResourceIntake,
  insertUnitResources,
  listResourceIntakes,
  listResourceRows,
  listResourceUsage,
  listUnitResources,
  lockResourceIntake,
  lockResources,
  updateResourceRow,
} from "./resource.repo";
import type {
  AddResourceStockInput,
  CreateResourceInput,
  UnitResourcesInput,
  UpdateResourceInput,
} from "./resource.schema";

/** MySQL: cannot delete a parent row, a foreign key restricts it (errno 1451). */
const ROW_IS_REFERENCED = "ER_ROW_IS_REFERENCED_2";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function createResource(
  input: CreateResourceInput,
  createdBy: string | null,
): Promise<Resource> {
  try {
    const id = await withTransaction(async (conn) => {
      const quantity = input.quantity ?? 0;
      const resourceId = await insertResource(conn, {
        name: input.name,
        description: input.description,
        inStock: quantity,
      });
      if (quantity > 0) {
        await insertResourceIntake(conn, {
          resourceId,
          quantity,
          intakeDate: todayISO(),
          notes: input.notes,
          createdBy,
        });
      }
      return resourceId;
    });
    return (await findResourceById(id))!;
  } catch (err) {
    if (isUnique(err)) throw conflict(`Resource "${input.name}" already exists`);
    throw err;
  }
}

export function listResources(): Promise<Resource[]> {
  return listResourceRows();
}

export async function getResource(id: string): Promise<ResourceDetail> {
  const resource = await findResourceById(id);
  if (!resource) throw notFound("Resource");
  const [intakes, usage] = await Promise.all([listResourceIntakes(id), listResourceUsage(id)]);
  return { ...resource, intakes, usage };
}

export async function updateResource(
  id: string,
  patch: UpdateResourceInput,
): Promise<Resource> {
  const columns: Record<string, unknown> = {};
  if (patch.name !== undefined) columns["name"] = patch.name;
  if (patch.description !== undefined) columns["description"] = patch.description;
  try {
    if (!(await updateResourceRow(id, columns))) throw notFound("Resource");
  } catch (err) {
    if (isUnique(err)) throw conflict(`Resource "${patch.name}" already exists`);
    throw err;
  }
  return (await findResourceById(id))!;
}

export async function deleteResource(id: string): Promise<void> {
  try {
    if (!(await deleteResourceRow(id))) throw notFound("Resource");
  } catch (err) {
    if ((err as { code?: string }).code === ROW_IS_REFERENCED) {
      throw conflict(
        "Units were built with this resource, so it can't be deleted. Remove it from those units first.",
      );
    }
    throw err;
  }
}

/** Add stock to a resource: one logged intake of `quantity`. */
export async function addResourceStock(
  id: string,
  input: AddResourceStockInput,
  createdBy: string | null,
): Promise<Resource> {
  await withTransaction(async (conn) => {
    if (!(await changeResourceStock(conn, id, input.quantity))) throw notFound("Resource");
    await insertResourceIntake(conn, {
      resourceId: id,
      quantity: input.quantity,
      intakeDate: input.intakeDate ?? todayISO(),
      notes: input.notes,
      createdBy,
    });
  });
  return (await findResourceById(id))!;
}

/**
 * Undo an intake entered by mistake: its quantity comes back out of stock.
 * Refused when part of it has already been used (stock would go negative).
 */
export async function deleteResourceIntake(id: string, intakeId: string): Promise<Resource> {
  await withTransaction(async (conn) => {
    const intake = await lockResourceIntake(conn, id, intakeId);
    if (!intake) throw notFound("Stock entry");
    if (!(await changeResourceStock(conn, id, -intake.quantity))) {
      throw conflict(
        `Can't undo: fewer than ${intake.quantity} of this resource are left in stock (some were already used).`,
      );
    }
    await deleteResourceIntakeRow(conn, intakeId);
  });
  return (await findResourceById(id))!;
}

/**
 * Move several resources' stock at once, inside the caller's transaction:
 * `deltas` maps resource id -> change (negative takes stock out). Resources
 * are locked in id order; if any would go below zero, nothing is moved and a
 * 409 names the resource that ran short.
 */
export async function moveResources(
  conn: Queryable,
  deltas: Map<string, number>,
): Promise<void> {
  const ids = [...deltas.keys()].filter((id) => deltas.get(id) !== 0);
  const locked = await lockResources(conn, ids);
  if (locked.length !== ids.length) throw notFound("Resource");
  for (const r of locked) {
    const delta = deltas.get(r.id)!;
    if (!(await changeResourceStock(conn, r.id, delta))) {
      throw conflict(`Not enough ${r.name}: ${-delta} needed, ${r.in_stock} in stock`);
    }
  }
}

/** Take `lines` (per-unit quantities) for `units` new units out of stock. */
export async function consumeForUnits(
  conn: Queryable,
  lines: UnitResourcesInput,
  units: number,
): Promise<void> {
  await moveResources(conn, new Map(lines.map((l) => [l.resourceId, -l.quantity * units])));
}

export async function getUnitResources(unitId: string): Promise<UnitResource[]> {
  if (!(await findUnitById(unitId))) throw notFound("Unit");
  return listUnitResources(pool, unitId);
}

/**
 * Replace the resources a unit was built with (e.g. ones forgotten at intake).
 * Stock moves by the difference: what the unit had is returned, what it has
 * now is taken.
 */
export async function setUnitResources(
  unitId: string,
  lines: UnitResourcesInput,
): Promise<UnitResource[]> {
  const unit = await findUnitById(unitId);
  if (!unit) throw notFound("Unit");
  await withTransaction(async (conn) => {
    // The module lock intake and unit delete take, so they can't interleave.
    await conn.query("SELECT id FROM modules WHERE id = ? FOR UPDATE", [unit.moduleId]);
    const current = await listUnitResources(conn, unitId);
    const deltas = new Map(current.map((c) => [c.resourceId, c.quantity]));
    for (const l of lines) {
      deltas.set(l.resourceId, (deltas.get(l.resourceId) ?? 0) - l.quantity);
    }
    await moveResources(conn, deltas);
    await deleteUnitResourceRows(conn, unitId);
    await insertUnitResources(conn, [unitId], lines);
  });
  return listUnitResources(pool, unitId);
}
