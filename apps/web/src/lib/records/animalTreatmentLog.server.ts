/**
 * 33B (B-50): builds the treatment log rows from tenant-scoped reads.
 * Withdrawal per food comes from the same `toTreatment` and
 * `computeWithdrawalClear` the health page uses, at the farm's time zone,
 * so the log, the page and the pack agree. Read-only: unlike the health
 * page, an export never stamps a lock.
 */

import {
  listAllHealthEvents,
  listAllHealthTombstones,
  type AnimalHealthEvent
} from '$lib/db/animalHealth';
import { documentPeople } from '$lib/db/documents';
import { listHoldCorrections } from '$lib/db/holdCorrections';
import { LOCK_WINDOW_MS } from '$lib/db/recordKinds';
import { farmTimeZone } from '$lib/db/userProfile';
import { displayFoods } from '$lib/animals/holdCopy';
import { animalLabel } from '$lib/animals/display';
import { identityLabel } from '$lib/identity';
import { organicTreatmentOutcomes } from '$lib/organic/animalStatus.server';
import { treatmentOutcomeText } from '$lib/organic/animalStatus';
import { organicHealthPlugins } from '$lib/organic/plugins.server';
import { hasOrganicStatusRows } from '$lib/db/organicStatus';
import { formatInstant, type Prefs } from '$lib/prefs';
import {
  carriesHold,
  computeWithdrawalClear,
  formatClearDate,
  FOODS,
  HOLD_BEARING_KINDS,
  parseWithdrawalEntries
} from '$lib/safety/animalWithdrawal';
import { healthPlugins, resolveSubject, toTreatment } from '$lib/server/animalRecords';
import { daysLate } from '$lib/server/animalProductionGate';
import { getDataKinds } from '$lib/server/registry';
import { lateLabel } from './lateLabel';
import {
  toTreatmentLogRow,
  type TreatmentLogRow,
  type TreatmentLogState
} from './animalTreatmentLog';

export type { TreatmentLogRow } from './animalTreatmentLog';

interface Dose {
  event: AnimalHealthEvent;
  deletion: { dosed: boolean } | null;
}

function lockedNow(
  e: AnimalHealthEvent,
  holds: boolean,
  foodProducingNow: boolean,
  now: number
): boolean {
  if (e.lockedAt) return true;
  if (!holds) return false;
  if (!e.foodProducingAtRecord && !foodProducingNow) return false;
  return now - e.administeredAt >= LOCK_WINDOW_MS;
}

/** Every dose of a hold-bearing kind in the window, live and deleted,
 *  oldest first. */
export async function buildTreatmentLog(
  window: { fromMs: number; toMs: number },
  prefs: Prefs,
  now = Date.now()
): Promise<TreatmentLogRow[]> {
  const inWindow = (e: AnimalHealthEvent) =>
    HOLD_BEARING_KINDS.includes(e.kind) &&
    e.administeredAt >= window.fromMs &&
    e.administeredAt <= window.toMs;
  const live = listAllHealthEvents().filter(inWindow);
  const liveIds = new Set(live.map((e) => e.id));
  const doses: Dose[] = [
    ...live.map((event) => ({ event, deletion: null })),
    ...listAllHealthTombstones()
      .filter((t) => !liveIds.has(t.recordId) && inWindow(t.event))
      .map((t) => ({ event: t.event, deletion: { dosed: t.dosed } }))
  ].sort(
    (a, b) =>
      a.event.administeredAt - b.event.administeredAt || a.event.id.localeCompare(b.event.id)
  );
  if (doses.length === 0) return [];

  const kinds = await getDataKinds();
  const plugins = await healthPlugins();
  const farmZone = farmTimeZone();
  const corrected = new Set(
    listHoldCorrections()
      .filter((c) => c.recordKind === 'animal-health')
      .map((c) => c.recordId)
  );
  const people = documentPeople(doses.map((d) => d.event.performedById));
  const outcomes = hasOrganicStatusRows()
    ? new Map(
        organicTreatmentOutcomes({
          fromMs: window.fromMs,
          toMs: window.toMs,
          plugins: await organicHealthPlugins()
        }).map((r) => [r.healthEventId, treatmentOutcomeText(r)])
      )
    : new Map<string, string>();

  const subjects = new Map<string, ReturnType<typeof resolveSubject>>();
  const subjectOf = (e: AnimalHealthEvent) => {
    const key = `${e.subjectType}:${e.subjectId}`;
    if (!subjects.has(key)) subjects.set(key, resolveSubject(e.subjectType, e.subjectId));
    return subjects.get(key) ?? null;
  };

  return doses.map(({ event: e, deletion }) => {
    const subject = subjectOf(e);
    const species = subject ? kinds.species.get(subject.speciesId) : undefined;
    const treatment = toTreatment(
      e,
      { speciesId: subject?.speciesId ?? 'unknown', sex: subject?.sex ?? null },
      deletion
    );
    const holds = carriesHold({ ...e, deletion });
    const clear = holds ? computeWithdrawalClear(treatment, plugins, { timeZone: farmZone }) : null;
    const entries = parseWithdrawalEntries(e.vetDirectedWithdrawal);
    const hasVetEntry = entries !== 'invalid' && entries.some((x) => x.kind === 'vet');
    const plugin = e.productPluginId ? kinds.animalHealth.get(e.productPluginId) : undefined;
    const person = e.performedById ? people.get(e.performedById) : undefined;
    let state: TreatmentLogState;
    if (deletion) state = deletion.dosed ? 'deleted-still-given' : 'voided';
    else if (corrected.has(e.id)) state = 'owner-corrected';
    else if (lockedNow(e, holds, subject?.foodProducing ?? true, now)) state = 'locked';
    else state = 'live';
    return toTreatmentLogRow(
      {
        administeredAt: e.administeredAt,
        courseEndAt: e.courseEndAt,
        subject: subject
          ? subject.animal
            ? animalLabel(subject.animal)
            : subject.name
          : e.subjectType === 'group'
            ? 'A removed group'
            : 'A removed animal',
        species: species?.displayName ?? 'Unknown species',
        product: clear?.product ?? e.productName ?? plugin?.displayName ?? 'No product named',
        approvalNumber: plugin?.approval
          ? `${plugin.approval.kind.toUpperCase()} ${plugin.approval.number}`
          : null,
        lot: e.lotNumber,
        dose: e.dose,
        doseUnit: e.doseUnit,
        route: e.route,
        givenBy: person ? identityLabel(person) : e.performedById ? 'A former member' : null,
        vet: e.vetName,
        labelUse: e.labelUse,
        foods: subject
          ? displayFoods(species ?? null, subject.sex, subject.foodProducing)
          : [...FOODS],
        holds: clear ? clear.foods : null,
        hasVetEntry,
        state,
        enteredLate: lateLabel(e.recordedLate === true, daysLate(e.administeredAt, e.createdAt)),
        organicOutcome: outcomes.get(e.id) ?? null
      },
      {
        date: (ms) => formatInstant(ms, prefs, 'date'),
        clearDate: (ms) => formatClearDate(ms, farmZone)
      }
    );
  });
}
