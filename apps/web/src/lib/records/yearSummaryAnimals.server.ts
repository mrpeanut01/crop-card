/**
 * 33B (plan item 8): loads the animal section of the year summary through
 * the tenant-scoped repos. Read-only. Covered declarations come from the
 * hold ledger's covered set (B-52), projected only when the year holds a
 * food or sale declaration.
 */

import { db } from '$lib/db/client';
import { animalGroups } from '$lib/db/schema';
import { withTenant } from '$lib/db/tenant';
import { listAnimals } from '$lib/db/animals';
import { listAnimalGroups } from '$lib/db/animalGroups';
import { listAllStatusEvents, type AnimalStatusEvent } from '$lib/db/animalStatus';
import { listAllLocations } from '$lib/db/animalLocations';
import { listAllHealthEvents, listAllHealthTombstones } from '$lib/db/animalHealth';
import {
  declaredFoodUse,
  listAllProductionLogs,
  type AnimalProductionLog
} from '$lib/db/animalProduction';
import { farmTimeZone } from '$lib/db/userProfile';
import { animalLabel } from '$lib/animals/display';
import { USE_LABEL } from '$lib/animals/healthCopy';
import { HOLD_BEARING_KINDS, type ProductionUse } from '$lib/safety/animalWithdrawal';
import { declaresMeat } from '$lib/server/animalRecords';
import { projectActiveFarm } from '$lib/server/holdGuard';
import { getDataKinds } from '$lib/server/registry';
import {
  ANIMAL_MOVEMENT_LABEL,
  computeYearAnimalSection,
  type CoveredInput,
  type GroupInput,
  type HoldBasisText,
  type NamedAnimalInput,
  type YearAnimalSection
} from './yearSummaryAnimals';

/** Raw unnamed head counts: the repo reads a missing count as 0, and B-51
 *  needs to tell "none" from "not known". */
function rawHeadCounts(): Map<string, number | null> {
  return new Map(
    db
      .select({ id: animalGroups.id, headCount: animalGroups.headCount })
      .from(animalGroups)
      .where(withTenant(animalGroups))
      .all()
      .map((r) => [r.id, r.headCount ?? null])
  );
}

export async function buildYearAnimalSection(
  window: { fromMs: number; toMs: number },
  nowMs = Date.now()
): Promise<YearAnimalSection | null> {
  const animals = listAnimals({ status: 'all' });
  const groups = listAnimalGroups({ status: 'all' });
  if (animals.length === 0 && groups.length === 0) return null;

  const statusEvents = listAllStatusEvents();
  const eventsBySubject = new Map<string, AnimalStatusEvent[]>();
  for (const e of statusEvents) {
    const key = `${e.subjectType}:${e.subjectId}`;
    eventsBySubject.set(key, [...(eventsBySubject.get(key) ?? []), e]);
  }

  const namedInputs: NamedAnimalInput[] = animals.map((a) => {
    const departure = (eventsBySubject.get(`animal:${a.id}`) ?? []).find(
      (e) => e.status !== 'active'
    );
    return {
      id: a.id,
      speciesId: a.speciesId,
      arrivalMs: a.acquiredDate ?? a.birthDate ?? a.createdAt,
      departure: departure ? { status: departure.status, atMs: departure.occurredAt } : null
    };
  });
  const heads = rawHeadCounts();
  const splitFrom = new Map<string, { parent: string; atMs: number }>();
  for (const l of listAllLocations()) {
    if (l.subjectType !== 'group' || !l.fromGroupId || l.toGroupId) continue;
    if (l.fromGroupId === l.subjectId) continue;
    const prev = splitFrom.get(l.subjectId);
    if (!prev || l.fromMs < prev.atMs) {
      splitFrom.set(l.subjectId, { parent: l.fromGroupId, atMs: l.fromMs });
    }
  }
  const groupInputs: GroupInput[] = groups.map((g) => ({
    id: g.id,
    speciesId: g.speciesId,
    createdAtMs: Math.min(g.createdAt, splitFrom.get(g.id)?.atMs ?? g.createdAt),
    splitFrom: splitFrom.get(g.id)?.parent ?? null,
    headCountNow: heads.has(g.id) ? (heads.get(g.id) ?? null) : g.headCount,
    events: (eventsBySubject.get(`group:${g.id}`) ?? []).map((e) => ({
      status: e.status,
      atMs: e.occurredAt,
      headCountDelta: e.headCountDelta
    }))
  }));

  const kinds = await getDataKinds();
  const names = new Map<string, string>();
  for (const a of animals) names.set(`animal:${a.id}`, animalLabel(a));
  for (const g of groups) names.set(`group:${g.id}`, g.name);
  const subjectName = (type: string, id: string) =>
    names.get(`${type}:${id}`) ?? (type === 'group' ? 'A removed group' : 'A removed animal');

  const inYear = (ms: number) => ms >= window.fromMs && ms <= window.toMs;
  const productOf = (e: { productName: string | null; productPluginId: string | null }) =>
    e.productName?.trim() ||
    (e.productPluginId
      ? (kinds.animalHealth.get(e.productPluginId)?.displayName ?? e.productPluginId)
      : null) ||
    'No product named';
  const live = listAllHealthEvents().filter(
    (e) => HOLD_BEARING_KINDS.includes(e.kind) && inYear(e.administeredAt)
  );
  const liveIds = new Set(live.map((e) => e.id));
  const doses = [
    ...live,
    ...listAllHealthTombstones()
      .filter(
        (t) =>
          t.dosed &&
          !liveIds.has(t.recordId) &&
          HOLD_BEARING_KINDS.includes(t.event.kind) &&
          inYear(t.event.administeredAt)
      )
      .map((t) => t.event)
  ].map((e) => ({ product: productOf(e), subject: subjectName(e.subjectType, e.subjectId) }));

  const logs = listAllProductionLogs();
  const production = logs
    .filter((l) => (l.kind === 'eggs' || l.kind === 'milk') && inYear(l.occurredAt))
    .map((l) => ({
      food: l.kind as 'eggs' | 'milk',
      use: l.use,
      useLabel: USE_LABEL[l.use as ProductionUse] ?? l.use,
      unit: l.unit,
      quantity: l.quantity
    }));

  const covered = await coveredInYear(logs, statusEvents, inYear, subjectName, nowMs);

  return computeYearAnimalSection({
    yearStartMs: window.fromMs,
    yearEndMs: window.toMs,
    speciesName: (id) => kinds.species.get(id)?.displayName ?? 'Unknown species',
    animals: namedInputs,
    groups: groupInputs,
    doses,
    production,
    covered
  });
}

async function coveredInYear(
  logs: readonly AnimalProductionLog[],
  statusEvents: readonly AnimalStatusEvent[],
  inYear: (ms: number) => boolean,
  subjectName: (type: string, id: string) => string,
  nowMs: number
): Promise<CoveredInput[]> {
  const declared = new Map<string, CoveredInput>();
  for (const l of logs) {
    if (l.kind !== 'eggs' && l.kind !== 'milk') continue;
    if (!inYear(l.occurredAt)) continue;
    const use = declaredFoodUse(l);
    if (use !== 'food' && use !== 'sale') continue;
    declared.set(`log:${l.id}`, {
      atMs: l.occurredAt,
      subject: subjectName(l.subjectType, l.subjectId),
      what: l.kind,
      use: USE_LABEL[use],
      basis: 'known'
    });
  }
  for (const e of statusEvents) {
    if (!declaresMeat(e) || !inYear(e.occurredAt)) continue;
    declared.set(`meat:${e.id}`, {
      atMs: e.occurredAt,
      subject: subjectName(e.subjectType, e.subjectId),
      what: 'meat',
      use: ANIMAL_MOVEMENT_LABEL[e.status] ?? e.status,
      basis: 'known'
    });
  }
  if (declared.size === 0) return [];
  const { projection } = await projectActiveFarm(farmTimeZone(), nowMs);
  const out: CoveredInput[] = [];
  for (const [id, basis] of projection.covered) {
    const hit = declared.get(id);
    if (hit) out.push({ ...hit, basis: basis as HoldBasisText });
  }
  return out;
}
