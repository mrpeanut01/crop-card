import { hasAnyAnimalRecord } from '$lib/db/animals';
import { declaredFoodUse, type AnimalProductionLog } from '$lib/db/animalProduction';
import type { AnimalStatusEvent } from '$lib/db/animalStatus';
import { coveredMeatIds, declaresMeat } from './animalRecords';
import { projectActiveFarm } from './holdGuard';

/**
 * G3-03: the hold ledger's covered `log:` and `meat:` ids for the active
 * farm, the same set the `hold-covers-sale` push reads, so the pages it
 * opens mark what it names. Empty for a farm with no animal records.
 */
export async function ledgerCoveredIds(
  timeZone: string,
  nowMs = Date.now()
): Promise<ReadonlySet<string>> {
  if (!hasAnyAnimalRecord()) return new Set();
  const { projection } = await projectActiveFarm(timeZone, nowMs);
  const out = new Set<string>();
  for (const id of projection.covered.keys()) {
    if (id.startsWith('log:') || id.startsWith('meat:')) out.add(id);
  }
  return out;
}

/** The ledger's covered set for a log page, projected only when one of the
 *  logs was ever saved as food or for sale. */
export async function ledgerCoveredForLogs(
  logs: readonly AnimalProductionLog[],
  timeZone: string
): Promise<ReadonlySet<string>> {
  const declares = logs.some((l) => {
    const use = declaredFoodUse(l);
    return use === 'food' || use === 'sale';
  });
  return declares ? ledgerCoveredIds(timeZone) : new Set();
}

/** Status changes marked `inHold` when they declare meat a hold covers; the
 *  farm is projected only when one of them declares meat. */
export async function withMeatHoldMarks<T extends AnimalStatusEvent>(
  events: readonly T[],
  timeZone: string
): Promise<Array<T & { inHold: boolean }>> {
  const meat = events.filter(declaresMeat);
  const covered = meat.length > 0 ? coveredMeatIds(meat, await ledgerCoveredIds(timeZone)) : null;
  return events.map((e) => ({ ...e, inHold: covered?.has(e.id) ?? false }));
}
