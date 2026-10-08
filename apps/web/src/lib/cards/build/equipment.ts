import { needsDecon as stateNeedsDecon } from '$lib/equipment/decon';
import { formatInstant } from '$lib/prefs';
import { chemistryClassLabel } from '$lib/records/chemistryClassLabel';
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

const EQUIPMENT_TYPE_KEY = {
  sprayer: 'cards.eq.type.sprayer',
  planter: 'cards.eq.type.planter',
  drill: 'cards.eq.type.drill',
  rake: 'cards.eq.type.rake',
  baler: 'cards.eq.type.baler',
  tractor: 'cards.eq.type.tractor',
  mower: 'cards.eq.type.mower',
  irrigation: 'cards.eq.type.irrigation',
  other: 'cards.eq.type.other'
} as const satisfies Record<SnapshotEquipmentType, string>;

/** True when the sprayer carried chemistry after its last decon. */
export function needsDecon(e: SnapshotEquipment): boolean {
  return stateNeedsDecon(e.state);
}

function day(ms: number | null | undefined, opts: ResolvedOptions): string | null {
  return typeof ms === 'number' && Number.isFinite(ms)
    ? formatInstant(ms, opts.prefs, 'month-day')
    : null;
}

function sprayerFacts(e: SnapshotEquipment, opts: ResolvedOptions): CardFact[] {
  const { tr } = opts;
  const s = e.state;
  const facts: CardFact[] = [];
  const gpa = s?.calibratedGpa;
  facts.push({
    label: tr('cards.eq.calibration'),
    value: isCalibratedGpa(gpa) ? `${trimNumber(gpa, 1)} GPA` : tr('cards.eq.notCalibrated'),
    provenance: 'data'
  });
  const calibrated = day(s?.calibrationDate, opts);
  if (calibrated && isCalibratedGpa(gpa)) {
    facts.push({ label: tr('cards.eq.calibrated'), value: calibrated, provenance: 'data' });
  }
  if (typeof e.tankGal === 'number' && e.tankGal > 0) {
    facts.push({
      label: tr('cards.eq.tank'),
      value: `${trimNumber(e.tankGal, 1)} gal`,
      provenance: 'manual'
    });
  }
  facts.push({
    label: tr('cards.eq.lastDecon'),
    value: day(s?.lastDeconAt, opts) ?? tr('cards.eq.noneOnRecord'),
    provenance: 'data'
  });
  if (s?.lastChemistryClass) {
    facts.push({
      label: tr('cards.eq.lastLoad'),
      value: needsDecon(e)
        ? tr('cards.eq.deconDue', { chemistry: chemistryClassLabel(s.lastChemistryClass, opts.prefs.locale) })
        : chemistryClassLabel(s.lastChemistryClass, opts.prefs.locale),
      provenance: 'data'
    });
  }
  return facts;
}

function commonFacts(e: SnapshotEquipment, opts: ResolvedOptions): CardFact[] {
  const facts: CardFact[] = [];
  const used = day(e.state?.lastUsedAt, opts);
  if (used) facts.push({ label: opts.tr('cards.eq.lastUsed'), value: used, provenance: 'data' });
  const winterized = day(e.state?.winterizedAt, opts);
  if (winterized)
    facts.push({ label: opts.tr('cards.eq.winterized'), value: winterized, provenance: 'data' });
  return facts;
}

function priorityAction(e: SnapshotEquipment, opts: ResolvedOptions): CardAction | undefined {
  if (e.type !== 'sprayer') return undefined;
  if (needsDecon(e)) {
    return { label: 'Run decon', href: `/spray/decon?sprayer=${encodeURIComponent(e.id)}` };
  }
  if (!isCalibratedGpa(e.state?.calibratedGpa)) {
    return { label: opts.tr('cards.eq.calibrate'), href: '/calibrate' };
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
  const upcoming = priorityAction(e, opts) ? tasks : tasks.slice(1);
  if (upcoming.length) {
    sections.push({
      title: opts.tr('cards.section.comingUp'),
      items: upcoming
        .slice(0, MAX_UPCOMING)
        .map((t) => `${t.title} (${dueLabel(t.scheduledFor, opts.now, opts.prefs)})`)
    });
  }

  const provenance: CardProvenance[] = [
    { source: 'manual', detail: opts.tr('cards.eq.provList') }
  ];
  if (facts.some((f) => f.provenance === 'data')) provenance.push({ source: 'data' });

  const key = cardKey('equipment', e.id);
  return {
    kind: 'equipment',
    key,
    kicker: opts.tr('cards.eq.kicker', {
      type: opts.tr(EQUIPMENT_TYPE_KEY[EQUIPMENT_TYPE_LABEL[e.type] ? e.type : 'other'])
    }),
    title: e.label,
    facts,
    next: priorityAction(e, opts) ?? nextAction(tasks, opts, snapshot.plantings),
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
