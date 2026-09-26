import { formatInstant } from '$lib/prefs';
import {
  cardHref,
  cardKey,
  mergeProvenance,
  type CardAction,
  type CardFact,
  type CardModel,
  type CardProvenance,
  type CardSection
} from '../model';
import type { FarmSnapshot, SnapshotEquipment, SnapshotEquipmentType } from '../snapshot';
import {
  dueLabel,
  nextAction,
  resolveOptions,
  sortTasks,
  trimNumber,
  type BuildOptions,
  type ResolvedOptions
} from './common';
import { isCalibratedGpa } from './spray';

const MAX_UPCOMING = 4;

export const EQUIPMENT_TYPE_LABEL: Record<SnapshotEquipmentType, string> = {
  sprayer: 'Sprayer',
  planter: 'Planter',
  drill: 'Drill',
  rake: 'Rake',
  baler: 'Baler',
  tractor: 'Tractor',
  mower: 'Mower',
  irrigation: 'Irrigation',
  other: 'Equipment'
};

/** True when the sprayer carried chemistry after its last decon. */
export function needsDecon(e: SnapshotEquipment): boolean {
  const s = e.state;
  if (!s?.lastChemistryClass || !s.lastUsedAt) return false;
  return !(s.lastDeconAt && s.lastDeconAt >= s.lastUsedAt);
}

function day(ms: number | null | undefined, opts: ResolvedOptions): string | null {
  return typeof ms === 'number' && Number.isFinite(ms)
    ? formatInstant(ms, opts.prefs, 'month-day')
    : null;
}

function sprayerFacts(e: SnapshotEquipment, opts: ResolvedOptions): CardFact[] {
  const s = e.state;
  const facts: CardFact[] = [];
  const gpa = s?.calibratedGpa;
  facts.push({
    label: 'Calibration',
    value: isCalibratedGpa(gpa) ? `${trimNumber(gpa, 1)} GPA` : 'Not calibrated',
    provenance: 'data'
  });
  const calibrated = day(s?.calibrationDate, opts);
  if (calibrated && isCalibratedGpa(gpa)) {
    facts.push({ label: 'Calibrated', value: calibrated, provenance: 'data' });
  }
  if (typeof e.tankGal === 'number' && e.tankGal > 0) {
    facts.push({ label: 'Tank', value: `${trimNumber(e.tankGal, 1)} gal`, provenance: 'manual' });
  }
  facts.push({
    label: 'Last decon',
    value: day(s?.lastDeconAt, opts) ?? 'None on record',
    provenance: 'data'
  });
  if (s?.lastChemistryClass) {
    facts.push({
      label: 'Last load',
      value: needsDecon(e) ? `${s.lastChemistryClass}, decon due` : s.lastChemistryClass,
      provenance: 'data'
    });
  }
  return facts;
}

function commonFacts(e: SnapshotEquipment, opts: ResolvedOptions): CardFact[] {
  const facts: CardFact[] = [];
  const used = day(e.state?.lastUsedAt, opts);
  if (used) facts.push({ label: 'Last used', value: used, provenance: 'data' });
  const winterized = day(e.state?.winterizedAt, opts);
  if (winterized) facts.push({ label: 'Winterized', value: winterized, provenance: 'data' });
  return facts;
}

function priorityAction(e: SnapshotEquipment): CardAction | undefined {
  if (e.type !== 'sprayer') return undefined;
  if (needsDecon(e)) {
    return { label: 'Run decon', href: `/spray/decon?sprayer=${encodeURIComponent(e.id)}` };
  }
  if (!isCalibratedGpa(e.state?.calibratedGpa)) {
    return { label: 'Calibrate this sprayer', href: '/calibrate' };
  }
  return undefined;
}

export function buildEquipmentCard(
  snapshot: FarmSnapshot,
  equipmentId: string,
  options: BuildOptions = {}
): CardModel | null {
  const e = snapshot.equipment.find((x) => x.id === equipmentId);
  if (!e) return null;
  const opts = resolveOptions(snapshot, options);
  const facts = [...(e.type === 'sprayer' ? sprayerFacts(e, opts) : []), ...commonFacts(e, opts)];

  const tasks = sortTasks(snapshot.tasks.filter((t) => t.equipmentId === e.id));
  const sections: CardSection[] = [];
  const upcoming = priorityAction(e) ? tasks : tasks.slice(1);
  if (upcoming.length) {
    sections.push({
      title: 'Coming up',
      items: upcoming
        .slice(0, MAX_UPCOMING)
        .map((t) => `${t.title} (${dueLabel(t.scheduledFor, opts.now, opts.prefs)})`)
    });
  }

  const provenance: CardProvenance[] = [{ source: 'manual', detail: 'your equipment list' }];
  if (facts.some((f) => f.provenance === 'data')) provenance.push({ source: 'data' });

  const key = cardKey('equipment', e.id);
  return {
    kind: 'equipment',
    key,
    kicker: `Equipment · ${EQUIPMENT_TYPE_LABEL[e.type] ?? EQUIPMENT_TYPE_LABEL.other}`,
    title: e.label,
    facts,
    next: priorityAction(e) ?? nextAction(tasks, opts),
    sections,
    asOf: snapshot.generatedAt,
    provenance: mergeProvenance(provenance),
    href: cardHref('equipment', key)
  };
}

export function buildEquipmentCards(
  snapshot: FarmSnapshot,
  options: BuildOptions = {}
): CardModel[] {
  return snapshot.equipment
    .map((e) => buildEquipmentCard(snapshot, e.id, options))
    .filter((c): c is CardModel => c !== null);
}
