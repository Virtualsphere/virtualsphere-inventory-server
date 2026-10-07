import { conflict, isUniqueViolation as isUnique, notFound } from "../../lib/errors";
import type { Module, ModuleWithCounts } from "../../types";
import { getSettings } from "../settings/settings.repo";
import { findProductById } from "../products/product.repo";
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

export function listModules(productId?: string): Promise<ModuleWithCounts[]> {
  return listModulesWithCounts(productId);
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
    const updated = await updateModuleRow(id, columns);
    if (!updated) throw notFound("Module");
    return updated;
  } catch (err) {
    if (isUnique(err)) throw conflict(`SKU "${patch.sku}" is already in use`);
    throw err;
  }
}

export async function deleteModule(id: string): Promise<void> {
  const ok = await deleteModuleRow(id);
  if (!ok) throw notFound("Module");
}
