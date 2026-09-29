import type { PageServerLoad } from './$types';
import { evaluateProductionLock, listProductionLogs } from '$lib/db/animalProduction';
import { loadRecordPageBase } from '$lib/animals/recordPages.server';
import { daysLate } from '$lib/server/animalProductionGate';
import { coveredLogIds, healthPlugins } from '$lib/server/animalRecords';

export const load: PageServerLoad = async (event) => {
  const base = await loadRecordPageBase(event);
  const { subject } = base;
  const rows = listProductionLogs(subject.type, subject.id, 50);
  const covered = coveredLogIds(
    subject.type,
    subject.id,
    rows,
    await healthPlugins(),
    base.timeZone
  );
  const logs = rows.map((l) => ({
    ...l,
    locked: evaluateProductionLock(l, subject.foodProducing) !== undefined,
    daysLate: daysLate(l.occurredAt, l.createdAt),
    inHold: covered.has(l.id)
  }));
  return { ...base, logs };
};
