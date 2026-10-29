import { conflict, isUniqueViolation as isUnique, notFound } from "../../lib/errors";
import type { TagCategory } from "../../types";
import {
  deleteCategoryRow,
  findCategoryById,
  insertCategory,
  listCategoryRows,
  renameCategoryRow,
} from "./category.repo";
import type { CategoryInput } from "./category.schema";

/** MySQL: cannot delete a parent row, a foreign key restricts it (errno 1451). */
const ROW_IS_REFERENCED = "ER_ROW_IS_REFERENCED_2";

export function listCategories(): Promise<TagCategory[]> {
  return listCategoryRows();
}

export async function createCategory(input: CategoryInput): Promise<TagCategory> {
  try {
    const id = await insertCategory(input.name);
    return (await findCategoryById(id))!;
  } catch (err) {
    if (isUnique(err)) throw conflict(`Category "${input.name}" already exists`);
    throw err;
  }
}

export async function renameCategory(id: string, input: CategoryInput): Promise<TagCategory> {
  try {
    if (!(await renameCategoryRow(id, input.name))) throw notFound("Category");
  } catch (err) {
    if (isUnique(err)) throw conflict(`Category "${input.name}" already exists`);
    throw err;
  }
  return (await findCategoryById(id))!;
}

export async function deleteCategory(id: string): Promise<void> {
  try {
    if (!(await deleteCategoryRow(id))) throw notFound("Category");
  } catch (err) {
    if ((err as { code?: string }).code === ROW_IS_REFERENCED) {
      throw conflict(
        "This category still has items, so it can't be deleted. Move or delete those items first.",
      );
    }
    throw err;
  }
}
