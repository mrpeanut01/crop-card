import { listCuttings, type HayCutting } from '$lib/db/hayCuttings';
import { daysLate } from '$lib/server/animalProductionGate';

export interface HayExportRow {
  cutting: HayCutting;
  /** The mow date (G2-07); a cutting always has one, `createdAt` covers old rows. */
  occurredAt: number;
  daysLate: number | null;
}

/** Hay cuttings for the CSV, USDA and VDACS exports, tenant-scoped through `listCuttings`. */
export function listHayForExport(filters: {
  blockId?: string;
  fromMs?: number;
  toMs?: number;
}): HayExportRow[] {
  const out: HayExportRow[] = [];
  for (const cutting of listCuttings({ blockId: filters.blockId })) {
    const occurredAt = cutting.mowAt ?? cutting.createdAt;
    if (filters.fromMs !== undefined && occurredAt < filters.fromMs) continue;
    if (filters.toMs !== undefined && occurredAt > filters.toMs) continue;
    out.push({ cutting, occurredAt, daysLate: hayDaysLate(cutting) });
  }
  return out.sort((a, b) => a.occurredAt - b.occurredAt);
}

/** G2-02: the day count for a cutting, from its mow date to its server save time. */
export function hayDaysLate(c: Pick<HayCutting, 'mowAt' | 'createdAt'>): number | null {
  return daysLate(c.mowAt ?? c.createdAt, c.createdAt);
}
