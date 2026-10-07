import { conflict, isUniqueViolation as isUnique, notFound } from "../../lib/errors";
import type { Product, ProductWithCounts } from "../../types";
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

/** MySQL: cannot delete a parent row, a foreign key restricts it (errno 1451). */
const ROW_IS_REFERENCED = "ER_ROW_IS_REFERENCED_2";

export async function createProduct(
  input: CreateProductInput,
): Promise<Product> {
  try {
    return await insertProduct({
      name: input.name,
      description: input.description,
    });
  } catch (err) {
    if (isUnique(err)) throw conflict(`Product "${input.name}" already exists`);
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
  if (patch.description !== undefined) columns["description"] = patch.description;

  try {
    const updated = await updateProductRow(id, columns);
    if (!updated) throw notFound("Product");
    return updated;
  } catch (err) {
    if (isUnique(err)) throw conflict(`Product "${patch.name}" already exists`);
    throw err;
  }
}

/** Only an empty product can be deleted: its modules must be deleted or moved first. */
export async function deleteProduct(id: string): Promise<void> {
  try {
    const ok = await deleteProductRow(id);
    if (!ok) throw notFound("Product");
  } catch (err) {
    if ((err as { code?: string } | null)?.code === ROW_IS_REFERENCED) {
      throw conflict("This product still has modules. Delete or move them first.");
    }
    throw err;
  }
}
