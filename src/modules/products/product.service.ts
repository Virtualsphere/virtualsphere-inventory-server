import { conflict, isUniqueViolation as isUnique, notFound } from "../../lib/errors";
import type { Product, ProductWithCounts } from "../../types";
import { getSettings } from "../settings/settings.repo";
import {
  deleteProductRow,
  findProductById,
  findProductWithCounts,
  insertProduct,
  listProductsWithCounts,
  updateProductRow,
} from "./product.repo";
import type {
  CreateProductInput,
  UpdateProductInput,
} from "./product.schema";

export async function createProduct(
  input: CreateProductInput,
): Promise<Product> {
  const settings = await getSettings();
  try {
    return await insertProduct({
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

export function listProducts(): Promise<ProductWithCounts[]> {
  return listProductsWithCounts();
}

export async function getProduct(id: string): Promise<ProductWithCounts> {
  const product = await findProductWithCounts(id);
  if (!product) throw notFound("Product");
  return product;
}

export async function updateProduct(
  id: string,
  patch: UpdateProductInput,
): Promise<Product> {
  const existing = await findProductById(id);
  if (!existing) throw notFound("Product");

  const columns: Record<string, unknown> = {};
  if (patch.name !== undefined) columns["name"] = patch.name;
  if (patch.sku !== undefined) columns["sku"] = patch.sku;
  if (patch.description !== undefined) columns["description"] = patch.description;
  if (patch.warrantyMonths !== undefined)
    columns["warranty_months"] = patch.warrantyMonths;
  if (patch.serialPrefix !== undefined)
    columns["serial_prefix"] = patch.serialPrefix;

  try {
    const updated = await updateProductRow(id, columns);
    if (!updated) throw notFound("Product");
    return updated;
  } catch (err) {
    if (isUnique(err)) throw conflict(`SKU "${patch.sku}" is already in use`);
    throw err;
  }
}

export async function deleteProduct(id: string): Promise<void> {
  const ok = await deleteProductRow(id);
  if (!ok) throw notFound("Product");
}
