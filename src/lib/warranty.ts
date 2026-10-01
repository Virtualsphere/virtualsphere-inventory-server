/** Warranty window computation, shared by the units and warranty modules. */

export interface WarrantyInfo {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  months: number;
  daysRemaining: number; // negative once expired
  expired: boolean;
  percentElapsed: number; // 0..100
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function computeWarranty(opts: {
  warrantyStart: string | null;
  intakeDate: string;
  warrantyMonths: number;
  today?: Date;
}): WarrantyInfo {
  const startStr = opts.warrantyStart ?? opts.intakeDate;
  const start = new Date(`${startStr}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + opts.warrantyMonths);

  const today = opts.today ?? new Date();
  const MS_PER_DAY = 86_400_000;

  const daysRemaining = Math.ceil(
    (end.getTime() - today.getTime()) / MS_PER_DAY,
  );
  const totalMs = end.getTime() - start.getTime();
  const elapsedMs = Math.min(
    Math.max(today.getTime() - start.getTime(), 0),
    Math.max(totalMs, 0),
  );
  const percentElapsed =
    totalMs > 0 ? Math.round((elapsedMs / totalMs) * 100) : 100;

  return {
    start: startStr,
    end: toISODate(end),
    months: opts.warrantyMonths,
    daysRemaining,
    expired: daysRemaining <= 0,
    percentElapsed,
  };
}
