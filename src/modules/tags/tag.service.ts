import { withTransaction } from "../../db/pool";
import { conflict, isUniqueViolation as isUnique, notFound } from "../../lib/errors";
import type { Tag, TagDetail } from "../../types";
import {
  changeTagStock,
  deleteTagIntakeRow,
  deleteTagRow,
  findTagById,
  insertTag,
  insertTagIntake,
  listTagGiven,
  listTagIntakes,
  listTagRows,
  lockTagIntake,
  updateTagRow,
} from "./tag.repo";
import type {
  AddTagStockInput,
  CreateTagInput,
  UpdateTagInput,
} from "./tag.schema";

/** MySQL: cannot delete a parent row, a foreign key restricts it (errno 1451). */
const ROW_IS_REFERENCED = "ER_ROW_IS_REFERENCED_2";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function createTag(
  input: CreateTagInput,
  createdBy: string | null,
): Promise<Tag> {
  try {
    const id = await withTransaction(async (conn) => {
      const quantity = input.quantity ?? 0;
      const tagId = await insertTag(conn, {
        name: input.name,
        description: input.description,
        inStock: quantity,
      });
      if (quantity > 0) {
        await insertTagIntake(conn, {
          tagId,
          quantity,
          intakeDate: todayISO(),
          notes: input.notes,
          createdBy,
        });
      }
      return tagId;
    });
    return (await findTagById(id))!;
  } catch (err) {
    if (isUnique(err)) throw conflict(`Tag "${input.name}" already exists`);
    throw err;
  }
}

export function listTags(): Promise<Tag[]> {
  return listTagRows();
}

export async function getTag(id: string): Promise<TagDetail> {
  const tag = await findTagById(id);
  if (!tag) throw notFound("Tag");
  const [intakes, given] = await Promise.all([listTagIntakes(id), listTagGiven(id)]);
  return { ...tag, intakes, given };
}

export async function updateTag(id: string, patch: UpdateTagInput): Promise<Tag> {
  const columns: Record<string, unknown> = {};
  if (patch.name !== undefined) columns["name"] = patch.name;
  if (patch.description !== undefined) columns["description"] = patch.description;
  try {
    if (!(await updateTagRow(id, columns))) throw notFound("Tag");
  } catch (err) {
    if (isUnique(err)) throw conflict(`Tag "${patch.name}" already exists`);
    throw err;
  }
  return (await findTagById(id))!;
}

export async function deleteTag(id: string): Promise<void> {
  try {
    if (!(await deleteTagRow(id))) throw notFound("Tag");
  } catch (err) {
    if ((err as { code?: string }).code === ROW_IS_REFERENCED) {
      throw conflict(
        "This tag has been given out, so it can't be deleted. Undo those stock-given records first.",
      );
    }
    throw err;
  }
}

/** Add stock to a tag: one logged intake of `quantity`. */
export async function addTagStock(
  id: string,
  input: AddTagStockInput,
  createdBy: string | null,
): Promise<Tag> {
  await withTransaction(async (conn) => {
    if (!(await changeTagStock(conn, id, input.quantity))) throw notFound("Tag");
    await insertTagIntake(conn, {
      tagId: id,
      quantity: input.quantity,
      intakeDate: input.intakeDate ?? todayISO(),
      notes: input.notes,
      createdBy,
    });
  });
  return (await findTagById(id))!;
}

/**
 * Undo an intake entered by mistake: its quantity comes back out of stock.
 * Refused when part of it has already been given out (stock would go negative).
 */
export async function deleteTagIntake(id: string, intakeId: string): Promise<Tag> {
  await withTransaction(async (conn) => {
    const intake = await lockTagIntake(conn, id, intakeId);
    if (!intake) throw notFound("Stock entry");
    if (!(await changeTagStock(conn, id, -intake.quantity))) {
      throw conflict(
        `Can't undo: fewer than ${intake.quantity} of this tag are left in stock (some were already given out).`,
      );
    }
    await deleteTagIntakeRow(conn, intakeId);
  });
  return (await findTagById(id))!;
}
