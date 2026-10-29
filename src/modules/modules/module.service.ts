import type { RowDataPacket } from "mysql2/promise";
import { withTransaction } from "../../db/pool";
import { conflict, isUniqueViolation as isUnique, notFound } from "../../lib/errors";
import type { Module, ModuleWithCounts, ProductKind } from "../../types";
import { getSettings } from "../settings/settings.repo";
import { findProductById } from "../products/product.repo";
import { moduleResourceTotals } from "../resources/resource.repo";
import { moveResources } from "../resources/resource.service";
import { reprefixSerials, type SerialModule, syncNextSeq } from "../units/unit.service";
import {
  deleteModuleRow,
  findModuleById,
  findModuleWithCounts,
  insertModule,
  listModulesWithCounts,
  updateModuleRow,
} from "./module.repo";
import type {
  CreateModuleInput,
  UpdateModuleInput,
} from "./module.schema";

async function assertProductExists(productId: string): Promise<void> {
  if (!(await findProductById(productId))) throw notFound("Product");
}

export async function createModule(
  input: CreateModuleInput,
): Promise<Module> {
  await assertProductExists(input.productId);
  const settings = await getSettings();
  try {
    return await insertModule({
      productId: input.productId,
      name: input.name,
      sku: input.sku,
      description: input.description,
      warrantyMonths: input.warrantyMonths ?? settings.defaultWarrantyMonths,
      serialPrefix: input.serialPrefix ?? null,
    });
  } catch (err) {
    if (isUnique(err)) throw conflict(`SKU "${input.sku}" is already in use`);
    throw err;
  }
}

export function listModules(
  filter: { productId?: string; kind?: ProductKind } = {},
): Promise<ModuleWithCounts[]> {
  return listModulesWithCounts(filter);
}

export async function getModule(id: string): Promise<ModuleWithCounts> {
  const mod = await findModuleWithCounts(id);
  if (!mod) throw notFound("Module");
  return mod;
}

export async function updateModule(
  id: string,
  patch: UpdateModuleInput,
): Promise<Module> {
  const existing = await findModuleById(id);
  if (!existing) throw notFound("Module");

  const columns: Record<string, unknown> = {};
  if (patch.productId !== undefined) {
    await assertProductExists(patch.productId);
    columns["product_id"] = patch.productId;
  }
  if (patch.name !== undefined) columns["name"] = patch.name;
  if (patch.sku !== undefined) columns["sku"] = patch.sku;
  if (patch.description !== undefined) columns["description"] = patch.description;
  if (patch.warrantyMonths !== undefined)
    columns["warranty_months"] = patch.warrantyMonths;
  if (patch.serialPrefix !== undefined)
    columns["serial_prefix"] = patch.serialPrefix;

  try {
    await withTransaction(async (conn) => {
      // The lock intake takes, so no units are added while serials are renamed.
      const [rows] = await conn.query<(SerialModule & RowDataPacket)[]>(
        "SELECT id, name, sku, serial_prefix FROM modules WHERE id = ? FOR UPDATE",
        [id],
      );
      const before = rows[0];
      if (!before || !(await updateModuleRow(id, columns, conn))) throw notFound("Module");
      // Existing units' generated serials follow a changed prefix (override).
      if (patch.serialPrefix !== undefined) {
        await reprefixSerials(conn, before, { ...before, serial_prefix: patch.serialPrefix });
      }
    });
  } catch (err) {
    if (isUnique(err)) throw conflict(`SKU "${patch.sku}" is already in use`);
    throw err;
  }
  // The SKU, name and prefix decide which serials count as generated ones.
  if (patch.sku !== undefined || patch.name !== undefined || patch.serialPrefix !== undefined) {
    await syncNextSeq(id);
  }
  return (await findModuleById(id))!;
}

/**
 * Delete a module and all its units. Resources used by units that were never
 * given out go back in stock; those given out stay used.
 */
export async function deleteModule(id: string): Promise<void> {
  await withTransaction(async (conn) => {
    // The module lock intake takes, so no units are added meanwhile.
    await conn.query("SELECT id FROM modules WHERE id = ? FOR UPDATE", [id]);
    const used = await moduleResourceTotals(conn, id);
    await moveResources(conn, new Map(used.map((r) => [r.resourceId, r.quantity])));
    if (!(await deleteModuleRow(id, conn))) throw notFound("Module");
  });
}
