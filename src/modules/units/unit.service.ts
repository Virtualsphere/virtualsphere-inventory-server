import { pool, type Queryable, withTransaction } from "../../db/pool";
import type { RowDataPacket } from "mysql2/promise";
import {
  conflict,
  isUniqueViolation as isUnique,
  notFound,
} from "../../lib/errors";
import { formatSerial, productCode, serialBase } from "../../lib/serial";
import type { Settings, Unit, UnitView } from "../../types";
import { insertUnitResources, listUnitResources } from "../resources/resource.repo";
import { consumeForUnits, moveResources } from "../resources/resource.service";
import { getSettings } from "../settings/settings.repo";
import {
  bulkInsertUnits,
  deleteUnitRow,
  findExistingInternalSerials,
  findUnitById,
  type InsertableUnit,
  listUnits,
  listUnitsByModule,
  listUnitsForExport,
  type ListUnitsResult,
  maxSeq,
  maxSerialNumber,
  updateUnitRow,
} from "./unit.repo";
import type {
  IntakeInput,
  ListUnitsInput,
  UpdateUnitInput,
} from "./unit.schema";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Row shape returned by the locking SELECT inside intake. */
interface LockedModuleRow extends RowDataPacket {
  id: string;
  name: string;
  sku: string;
  product_id: string;
  product_name: string;
  warranty_months: number;
  serial_prefix: string | null;
}

/**
 * Map a duplicate-key error on units to a 409. The internal-serial key gets
 * its own message naming the serial; anything else uses `fallback`.
 */
function duplicateSerialConflict(err: unknown, fallback: string) {
  const msg = (err as { sqlMessage?: string }).sqlMessage ?? "";
  if (msg.includes("units_internal_serial_key")) {
    const value = /Duplicate entry '(.*)' for key/.exec(msg)?.[1];
    return conflict(
      value
        ? `Internal serial "${value}" is already in use`
        : "That internal serial is already in use",
    );
  }
  return conflict(fallback, msg || undefined);
}

/** The module columns that decide what its generated serials look like. */
interface SerialModule {
  id: string;
  name: string;
  sku: string;
  serial_prefix: string | null;
}

/** `PREFIX-CODE` of a module's generated serials. */
function moduleSerialBase(mod: SerialModule, settings: Settings): string {
  return serialBase(
    mod.serial_prefix ?? settings.serialPrefix ?? "",
    productCode(mod.sku, mod.name),
  );
}

/** The number the module's next generated serial gets: one past its highest. */
async function nextSerialNumber(
  conn: Queryable,
  mod: SerialModule,
  settings: Settings,
): Promise<number> {
  return (await maxSerialNumber(conn, mod.id, moduleSerialBase(mod, settings))) + 1;
}

/**
 * Recompute `next_seq` (the number shown as "next #" in the intake preview)
 * from the units that exist now, for one module or all of them. Numbers freed
 * by deleting or renaming units become available again.
 */
export async function syncNextSeq(
  moduleId?: string,
  conn: Queryable = pool,
): Promise<void> {
  const settings = await getSettings(conn);
  const [mods] = await conn.query<(SerialModule & RowDataPacket)[]>(
    `SELECT id, name, sku, serial_prefix FROM modules
     ${moduleId ? "WHERE id = ?" : ""}`,
    moduleId ? [moduleId] : [],
  );
  for (const mod of mods) {
    const next = await nextSerialNumber(conn, mod, settings);
    await conn.query(
      "UPDATE modules SET next_seq = ? WHERE id = ? AND next_seq <> ?",
      [next, mod.id, next],
    );
  }
}

export interface IntakeResult {
  created: number;
  units: UnitView[];
}

/**
 * INTAKE — the race-free core.
 *
 * The whole operation runs in one InnoDB transaction. `SELECT ... FOR UPDATE`
 * on the module row takes an exclusive row lock, so any other intake on the SAME module
 * blocks until this transaction commits and only then reads the module's units.
 * That serializes serial allocation per module: no two units can ever be
 * assigned the same sequence number (and the UNIQUE (module_id, seq) and
 * UNIQUE (internal_serial) indexes are the belt-and-braces backstop).
 *
 * Generated serials continue from the module's highest existing one, not from
 * a stored counter, so numbers freed by deleting units are reused. `seq` is
 * just the per-module insertion order and no longer matches the serial.
 */
export async function intake(input: IntakeInput): Promise<IntakeResult> {
  const serials = input.manufacturerSerials ?? [];
  const count = input.quantity ?? serials.length;
  const intakeDate = input.intakeDate ?? todayISO();

  return withTransaction(async (conn) => {
    const [locked] = await conn.query<LockedModuleRow[]>(
      `SELECT m.id, m.name, m.sku, m.warranty_months, m.serial_prefix,
              p.id AS product_id, p.name AS product_name
       FROM modules m
       JOIN products p ON p.id = m.product_id
       WHERE m.id = ?
       FOR UPDATE OF m`,
      [input.moduleId],
    );
    const mod = locked[0];
    if (!mod) throw notFound("Module");

    const settings: Settings = await getSettings(conn);
    const prefix = mod.serial_prefix ?? settings.serialPrefix ?? "";
    const code = productCode(mod.sku, mod.name);
    const overrides = input.internalSerials ?? [];

    // Generated serials must not collide with this batch's overrides, nor with
    // an existing unit that was renamed by hand to a would-be generated serial.
    // Such seqs are skipped. Existing serials are fetched lazily, a window at
    // a time, since collisions are rare.
    const reserved = new Set(
      overrides.filter((s): s is string => !!s).map((s) => s.toLowerCase()),
    );
    const existing = new Set<string>();
    const window = count + 16;
    let num = await nextSerialNumber(conn, mod, settings);
    let fetchedUpTo = num;
    let seq = (await maxSeq(conn, mod.id)) + 1;

    const nextGenerated = async (): Promise<string> => {
      for (;;) {
        if (num >= fetchedUpTo) {
          const candidates = Array.from({ length: window }, (_, k) =>
            formatSerial(prefix, code, fetchedUpTo + k),
          );
          for (const s of await findExistingInternalSerials(conn, candidates))
            existing.add(s.toLowerCase());
          fetchedUpTo += window;
        }
        const candidate = formatSerial(prefix, code, num);
        const key = candidate.toLowerCase();
        if (!existing.has(key) && !reserved.has(key)) return candidate;
        num++;
      }
    };

    const toInsert: InsertableUnit[] = [];
    for (let i = 0; i < count; i++) {
      const internalSerial = overrides[i] ?? (await nextGenerated());
      num++;
      toInsert.push({
        moduleId: mod.id,
        seq: seq++,
        internalSerial,
        manufacturerSerial: serials[i] ?? null,
        intakeDate,
        warrantyStart: intakeDate,
        warrantyMonths: mod.warranty_months,
        notes: input.notes,
      });
    }

    let inserted: Unit[];
    try {
      inserted = await bulkInsertUnits(conn, toInsert);
    } catch (err) {
      if (isUnique(err)) {
        throw duplicateSerialConflict(
          err,
          "One or more manufacturer serials already exist for this module",
        );
      }
      throw err;
    }

    // Every new unit is built with the same per-unit resources.
    const resources = input.resources ?? [];
    if (resources.length) {
      await consumeForUnits(conn, resources, inserted.length);
      await insertUnitResources(conn, inserted.map((u) => u.id), resources);
    }

    // An override may itself look generated (e.g. a higher number), so
    // recompute from the rows rather than trusting `num`.
    await syncNextSeq(mod.id, conn);

    const units: UnitView[] = inserted.map((u) => ({
      ...u,
      moduleName: mod.name,
      sku: mod.sku,
      productId: mod.product_id,
      productName: mod.product_name,
    }));
    return { created: units.length, units };
  });
}

export function listUnitsPaged(input: ListUnitsInput): Promise<ListUnitsResult> {
  return listUnits({
    q: input.q,
    moduleId: input.moduleId,
    productId: input.productId,
    status: input.status,
    sort: input.sort,
    limit: input.limit,
    offset: input.offset,
  });
}

export async function getUnit(id: string): Promise<UnitView> {
  const unit = await findUnitById(id);
  if (!unit) throw notFound("Unit");
  return unit;
}

export function listUnitsForModule(moduleId: string): Promise<UnitView[]> {
  return listUnitsByModule(moduleId);
}

export async function updateUnit(
  id: string,
  patch: UpdateUnitInput,
): Promise<UnitView> {
  const existing = await findUnitById(id);
  if (!existing) throw notFound("Unit");

  const columns: Record<string, unknown> = {};
  if (patch.status !== undefined) columns["status"] = patch.status;
  if (patch.internalSerial !== undefined)
    columns["internal_serial"] = patch.internalSerial;
  if (patch.manufacturerSerial !== undefined)
    columns["manufacturer_serial"] = patch.manufacturerSerial;
  if (patch.soldTo !== undefined) columns["sold_to"] = patch.soldTo;
  if (patch.soldDate !== undefined) columns["sold_date"] = patch.soldDate;
  if (patch.warrantyStart !== undefined)
    columns["warranty_start"] = patch.warrantyStart;
  if (patch.warrantyMonths !== undefined)
    columns["warranty_months"] = patch.warrantyMonths;
  if (patch.notes !== undefined) columns["notes"] = patch.notes;

  // Convenience: marking a unit sold with no sold date set stamps today.
  if (
    patch.status === "sold" &&
    patch.soldDate === undefined &&
    !existing.soldDate
  ) {
    columns["sold_date"] = todayISO();
  }

  try {
    const ok = await updateUnitRow(id, columns);
    if (!ok) throw notFound("Unit");
  } catch (err) {
    if (isUnique(err)) {
      throw duplicateSerialConflict(
        err,
        "That manufacturer serial already exists for this module",
      );
    }
    throw err;
  }

  if (patch.internalSerial !== undefined) await syncNextSeq(existing.moduleId);

  return (await findUnitById(id))!;
}

/**
 * Delete a unit (e.g. one added by mistake). Units on a stock-given record
 * can't be deleted; undo that record first. Its serial number becomes free
 * for the next intake if it was the module's highest, and the resources it
 * was built with go back in stock.
 */
export async function deleteUnit(id: string): Promise<void> {
  const unit = await findUnitById(id);
  if (!unit) throw notFound("Unit");
  if (unit.dispatchId) {
    throw conflict(
      "This unit was given out. Undo its stock-given record first, then delete it.",
    );
  }
  await withTransaction(async (conn) => {
    // Same lock as intake, so the counter can't move under a running intake.
    await conn.query("SELECT id FROM modules WHERE id = ? FOR UPDATE", [
      unit.moduleId,
    ]);
    const used = await listUnitResources(conn, id);
    await moveResources(conn, new Map(used.map((r) => [r.resourceId, r.quantity])));
    if (!(await deleteUnitRow(conn, id))) {
      throw conflict("This unit was just given out or deleted; reload and try again.");
    }
    await syncNextSeq(unit.moduleId, conn);
  });
}

// --- CSV export -----------------------------------------------------------

const CSV_COLUMNS: Array<[header: string, pick: (u: UnitView) => string]> = [
  ["internal_serial", (u) => u.internalSerial],
  ["manufacturer_serial", (u) => u.manufacturerSerial ?? ""],
  ["product_name", (u) => u.productName],
  ["module_name", (u) => u.moduleName],
  ["sku", (u) => u.sku],
  ["status", (u) => u.status],
  ["intake_date", (u) => u.intakeDate],
  ["warranty_start", (u) => u.warrantyStart ?? ""],
  ["warranty_months", (u) => String(u.warrantyMonths)],
  ["sold_to", (u) => u.soldTo ?? ""],
  ["sold_date", (u) => u.soldDate ?? ""],
  ["notes", (u) => u.notes],
];

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function exportUnitsCsv(filters: {
  q?: string;
  moduleId?: string;
  productId?: string;
  status?: UnitView["status"];
}): Promise<string> {
  const units = await listUnitsForExport(filters);
  const header = CSV_COLUMNS.map(([h]) => h).join(",");
  const lines = units.map((u) =>
    CSV_COLUMNS.map(([, pick]) => csvCell(pick(u))).join(","),
  );
  return [header, ...lines].join("\r\n");
}
