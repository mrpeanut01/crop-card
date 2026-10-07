import { sql, type SQL } from 'drizzle-orm';
import { db } from '$lib/db/client';
import {
  animalHealthEvents,
  animalProductionLogs,
  animalStatusEvents,
  fertilityApplications,
  fungicideEvents,
  harvestEvents,
  hayCuttings,
  insecticideEvents,
  scoutObservations,
  sprayEvents
} from '$lib/db/schema';
import { withTenant, type TenantScopedTable } from '$lib/db/tenant';
import { zonedDayStartMs } from '$lib/exports/dateRange';
import { listYearsWithCrops } from '$lib/db/crops';

const MINUTE_MS = 60_000;

function distinctMinutes(table: TenantScopedTable, at: SQL): number[] {
  return db
    .selectDistinct({ m: sql<number>`(${at}) / ${MINUTE_MS}` })
    .from(table)
    .where(withTenant(table))
    .all()
    .map((r) => Number(r.m))
    .filter((m) => Number.isFinite(m));
}

/** The calendar year (in `timeZone`) of each instant. */
export function yearsInZone(instantsMs: Iterable<number>, timeZone: string): Set<number> {
  const startOf = new Map<number, number>();
  const start = (y: number) => {
    let ms = startOf.get(y);
    if (ms === undefined) {
      ms = zonedDayStartMs(y, 1, 1, timeZone);
      startOf.set(y, ms);
    }
    return ms;
  };
  const years = new Set<number>();
  for (const ms of instantsMs) {
    let y = new Date(ms).getUTCFullYear();
    if (ms < start(y)) y -= 1;
    else if (ms >= start(y + 1)) y += 1;
    years.add(y);
  }
  return years;
}

/** Every year (in the farm's zone) that holds a record the year summary
 *  reads, plus the planting years. Tenant-scoped on every table (#744). */
export function listYearsWithRecords(timeZone: string): number[] {
  const minutes: number[] = [
    ...distinctMinutes(sprayEvents, sql`${sprayEvents.occurredAt}`),
    ...distinctMinutes(insecticideEvents, sql`${insecticideEvents.occurredAt}`),
    ...distinctMinutes(fungicideEvents, sql`${fungicideEvents.occurredAt}`),
    ...distinctMinutes(harvestEvents, sql`${harvestEvents.occurredAt}`),
    ...distinctMinutes(hayCuttings, sql`coalesce(${hayCuttings.mowAt}, ${hayCuttings.createdAt})`),
    ...distinctMinutes(fertilityApplications, sql`${fertilityApplications.occurredAt}`),
    ...distinctMinutes(scoutObservations, sql`${scoutObservations.occurredAt}`),
    ...distinctMinutes(animalHealthEvents, sql`${animalHealthEvents.administeredAt}`),
    ...distinctMinutes(animalProductionLogs, sql`${animalProductionLogs.occurredAt}`),
    ...distinctMinutes(animalStatusEvents, sql`${animalStatusEvents.occurredAt}`)
  ];
  const years = yearsInZone(
    minutes.map((m) => m * MINUTE_MS),
    timeZone
  );
  for (const y of listYearsWithCrops()) years.add(y);
  return [...years].sort((a, b) => b - a);
}

/** The year the Year in review opens on: the current year when it has
 *  records (or nothing has any), else the latest earlier year with records. */
export function defaultSummaryYear(
  currentYear: number,
  yearsWithRecords: readonly number[]
): number {
  if (yearsWithRecords.includes(currentYear)) return currentYear;
  const earlier = yearsWithRecords.filter((y) => y < currentYear);
  return earlier.length ? Math.max(...earlier) : currentYear;
}
