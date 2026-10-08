/**
 * Phase 30G: read-only Cards for saved records on /records. The record is
 * the legal copy; these cards only show what it says, plus label facts
 * from the product plugin, and print with a QR back to the record.
 */

import { formatInstant, formatQuantity, type Prefs } from '$lib/prefs';
import { FALLBACK_RATE_LINE } from '$lib/plugins/rateProvenance';
import {
  mergeProvenance,
  plantingCardHref,
  recordCardKey,
  recordHref,
  type CardFact,
  type CardModel,
  type CardProvenance,
  type CardSection
} from '../model';
import type { SnapshotSprayProduct } from '../snapshot';
import { SPRAY_RECHECK_NOTICE, SPRAY_REFERENCE_NOTICE, beforeYouSpray } from './spray';
import { trimNumber } from './common';
import { t } from '$lib/i18n';
import { scoutMetricLabel, scoutPestLabel } from '$lib/records/metricLabel';

export const RECORD_COPY_NOTICE = 'Read-only copy of a saved record. The record is the legal copy.';
export const OPEN_RECORD_LABEL = 'Open full record';

export type SprayRecordKind = 'spray' | 'insecticide' | 'fungicide';

const SPRAY_KIND_LABEL = {
  spray: 'cards.record.kind.spray',
  insecticide: 'cards.record.kind.insecticide',
  fungicide: 'cards.record.kind.fungicide'
} as const satisfies Record<SprayRecordKind, string>;

export interface SprayRecordProduct {
  pluginId: string;
  displayName: string;
  /** The rate saved on the record, if one was. */
  rate: { amount: number; unit: string } | null;
  /** #737 swarm 2026-10-07: a herbicide rate that was not from the label. */
  rateFallback?: boolean;
  /** Label facts from the product plugin; null when it is no longer installed. */
  label: SnapshotSprayProduct | null;
}

export interface SprayRecordCardInput {
  recordKind: SprayRecordKind;
  rowId: string;
  occurredAt: number;
  blockLabel: string | null;
  sprayerLabel: string | null;
  products: SprayRecordProduct[];
  conditions: {
    windMph: number;
    tempF: number;
    provenance: 'measured' | 'default' | null;
  } | null;
  /** "Aphids · per plant = 12" for insecticide/fungicide thresholds. */
  observation: string | null;
  reEntryClearAt: number | null;
  preHarvestClearAt: number | null;
  rulesVersion: string;
  performerLabel: string | null;
  locked: boolean;
  customRateOverride: boolean;
}

export interface RecordCardOptions {
  prefs: Prefs;
  now: number;
}

function openRecordLink(recordKind: string, rowId: string, locale?: string | null) {
  return { label: t(locale, 'cards.record.open'), href: recordHref(recordKind, rowId) };
}

function lockStatus(locked: boolean, locale?: string | null): CardModel['status'] {
  return locked
    ? { label: t(locale, 'cards.record.locked'), tone: 'neutral' }
    : { label: t(locale, 'cards.record.editable'), tone: 'wheat' };
}

function copyNotice(locale?: string | null): string {
  return t(locale, 'cards.record.copyNotice');
}

function labelLine(p: SprayRecordProduct): string {
  const l = p.label;
  if (!l) return `${p.displayName}: label facts not on file, check the label`;
  const parts = [
    `EPA ${l.epaRegistrationNumber ?? 'reg. no. not on file'}`,
    `REI ${l.reEntryIntervalHours !== null ? `${l.reEntryIntervalHours} h` : 'see label'}`,
    `PHI ${l.preHarvestIntervalDays !== null ? `${l.preHarvestIntervalDays} d` : 'see label'}`
  ];
  return `${p.displayName}: ${parts.join(' · ')}`;
}

export function buildSprayRecordCard(
  input: SprayRecordCardInput,
  opts: RecordCardOptions
): CardModel {
  const { prefs } = opts;
  const loc = prefs.locale;
  const facts: CardFact[] = [
    {
      label: t(loc, 'cards.record.sprayed'),
      value: formatInstant(input.occurredAt, prefs, 'datetime'),
      provenance: 'data'
    }
  ];
  if (input.blockLabel)
    facts.push({ label: t(loc, 'cards.record.block'), value: input.blockLabel, provenance: 'data' });
  if (input.sprayerLabel) {
    facts.push({
      label: t(loc, 'cards.record.sprayer'),
      value: input.sprayerLabel,
      provenance: 'data'
    });
  }
  for (const p of input.products) {
    const rate = p.rate
      ? `${trimNumber(p.rate.amount, 2)} ${p.rate.unit}/A${input.customRateOverride ? ', custom rate' : ''}`
      : 'Rate not recorded';
    facts.push({
      label: p.displayName,
      value: rate,
      provenance: p.rateFallback ? 'fallback' : 'manual',
      englishOnly: true,
      ...(p.rateFallback ? { note: FALLBACK_RATE_LINE } : {})
    });
  }
  if (input.products.length === 1 && input.products[0].label) {
    facts.push({
      label: t(loc, 'cards.spray.epaReg'),
      value: input.products[0].label.epaRegistrationNumber ?? t(loc, 'cards.spray.epaMissing'),
      provenance: 'plugin'
    });
  }
  if (input.conditions) {
    facts.push({
      label: t(loc, 'cards.record.windTemp'),
      value: `${formatQuantity(input.conditions.windMph, 'speed', prefs)} · ${formatQuantity(
        input.conditions.tempF,
        'temperature',
        prefs
      )}`,
      provenance:
        input.conditions.provenance === 'default'
          ? 'fallback'
          : input.conditions.provenance === 'measured'
            ? 'manual'
            : undefined
    });
  }
  if (input.reEntryClearAt) {
    facts.push({
      label: 'Re-entry clear',
      value: formatInstant(input.reEntryClearAt, prefs, 'datetime'),
      provenance: 'data',
      englishOnly: true
    });
  }
  if (input.preHarvestClearAt) {
    facts.push({
      label: 'Harvest clear',
      value: formatInstant(input.preHarvestClearAt, prefs, 'month-day'),
      provenance: 'data',
      englishOnly: true
    });
  }
  if (input.performerLabel) {
    facts.push({
      label: t(loc, 'cards.record.recordedBy'),
      value: input.performerLabel,
      provenance: 'data'
    });
  }

  const sections: CardSection[] = [];
  const labels = input.products.map((p) => p.label).filter((l): l is SnapshotSprayProduct => !!l);
  const safety = [...new Set(labels.flatMap((l) => beforeYouSpray(l)))];
  if (safety.length)
    sections.push({
      title: t(loc, 'cards.record.beforeAgain'),
      items: safety,
      safety: true,
      englishOnly: 'items'
    });
  sections.push({
    title: t(loc, 'cards.record.labelFacts'),
    items: input.products.map(labelLine),
    englishOnly: 'items'
  });
  if (input.observation)
    sections.push({ title: t(loc, 'cards.record.scouting'), items: [input.observation] });
  const mix = labels.flatMap((l) => l.mixSteps);
  if (mix.length) sections.push({ title: 'Mix order', items: mix, englishOnly: 'all' });

  const provenance: CardProvenance[] = [
    { source: 'data', detail: t(loc, 'cards.record.provRecord') },
    ...labels.map((l) => ({ source: 'plugin' as const, detail: `${l.pluginId} · v${l.version}` }))
  ];
  if (input.conditions?.provenance === 'default') {
    provenance.push({ source: 'fallback', detail: t(loc, 'cards.record.provDefaultWeather') });
  }

  const key = recordCardKey(input.recordKind, input.rowId);
  return {
    kind: 'spray',
    key,
    kicker: [t(loc, SPRAY_KIND_LABEL[input.recordKind]), input.blockLabel]
      .filter(Boolean)
      .join(' · '),
    title: input.products.map((p) => p.displayName).join(', ') || 'Spray',
    status: lockStatus(input.locked, loc),
    facts,
    sections,
    asOf: opts.now,
    rulesVersion: input.rulesVersion,
    provenance: mergeProvenance(provenance),
    href: recordHref(input.recordKind, input.rowId),
    notices: [SPRAY_REFERENCE_NOTICE, SPRAY_RECHECK_NOTICE, copyNotice(loc)],
    englishOnlyNotices: [SPRAY_REFERENCE_NOTICE, SPRAY_RECHECK_NOTICE],
    links: [openRecordLink(input.recordKind, input.rowId, loc)]
  };
}

export interface ScoutRecordCardInput {
  rowId: string;
  occurredAt: number;
  blockLabel: string | null;
  plantingLabel: string | null;
  pest: string;
  metric: string;
  value: number;
  notes: string | null;
  performerLabel: string | null;
  locked: boolean;
}

export function buildScoutRecordCard(
  input: ScoutRecordCardInput,
  opts: RecordCardOptions
): CardModel {
  const loc = opts.prefs.locale;
  const facts: CardFact[] = [
    {
      label: t(loc, 'cards.record.seen'),
      value: formatInstant(input.occurredAt, opts.prefs, 'datetime'),
      provenance: 'data'
    }
  ];
  if (input.metric !== 'note')
    facts.push({
      label: scoutMetricLabel(input.metric, loc),
      value: trimNumber(input.value, 2),
      provenance: 'manual'
    });
  if (input.blockLabel)
    facts.push({ label: t(loc, 'cards.record.block'), value: input.blockLabel, provenance: 'data' });
  if (input.plantingLabel) {
    facts.push({ label: t(loc, 'cards.record.crop'), value: input.plantingLabel, provenance: 'data' });
  }
  if (input.performerLabel) {
    facts.push({
      label: t(loc, 'cards.record.scoutedBy'),
      value: input.performerLabel,
      provenance: 'data'
    });
  }
  const sections: CardSection[] = input.notes?.trim()
    ? [{ title: t(loc, 'cards.notes'), items: [input.notes.trim()] }]
    : [];
  const key = recordCardKey('scout', input.rowId);
  return {
    kind: 'scout',
    key,
    kicker: [t(loc, 'cards.record.scout'), input.blockLabel].filter(Boolean).join(' · '),
    title: (loc ? scoutPestLabel(input.pest.trim(), loc) : input.pest.trim()) ||
      t(loc, 'cards.record.scoutNote'),
    status: lockStatus(input.locked, loc),
    facts,
    sections,
    asOf: opts.now,
    provenance: [
      { source: 'manual', detail: t(loc, 'cards.record.provObservation') },
      { source: 'data', detail: t(loc, 'cards.record.provRecord') }
    ],
    href: recordHref('scout', input.rowId),
    notices: [copyNotice(loc)],
    links: [openRecordLink('scout', input.rowId, loc)]
  };
}

export interface HarvestRecordCardInput {
  rowId: string;
  occurredAt: number;
  blockLabel: string | null;
  cropLabel: string;
  quantity: string | null;
  lotNumber: string | null;
  moisturePct: number | null;
  /** The Planting Card this harvest came from, when one is on file. */
  plantingId: string | null;
  /** #662 form readings (pick number, Brix, ...), already worded. */
  detailLines?: string[];
  performerLabel?: string | null;
  locked: boolean;
}

/** #749: a harvest's own read-only card (date, amount, lot), with the
 *  Planting Card as a link. */
export function buildHarvestRecordCard(
  input: HarvestRecordCardInput,
  opts: RecordCardOptions
): CardModel {
  const loc = opts.prefs.locale;
  const facts: CardFact[] = [
    {
      label: t(loc, 'cards.record.harvested'),
      value: formatInstant(input.occurredAt, opts.prefs, 'date'),
      provenance: 'manual'
    },
    {
      label: t(loc, 'cards.record.quantity'),
      value: input.quantity?.trim() || t(loc, 'cards.record.notRecorded'),
      provenance: 'manual'
    }
  ];
  if (input.lotNumber?.trim())
    facts.push({
      label: t(loc, 'cards.record.lot'),
      value: input.lotNumber.trim(),
      provenance: 'manual'
    });
  if (input.moisturePct !== null)
    facts.push({
      label: t(loc, 'cards.record.moisture'),
      value: `${trimNumber(input.moisturePct, 1)}%`,
      provenance: 'manual'
    });
  if (input.blockLabel)
    facts.push({ label: t(loc, 'cards.record.block'), value: input.blockLabel, provenance: 'data' });
  if (input.performerLabel)
    facts.push({
      label: t(loc, 'cards.record.recordedBy'),
      value: input.performerLabel,
      provenance: 'data'
    });
  const sections: CardSection[] = input.detailLines?.length
    ? [{ title: t(loc, 'cards.record.readings'), items: input.detailLines, provenance: 'manual' }]
    : [];
  const links = [openRecordLink('harvest', input.rowId, loc)];
  if (input.plantingId)
    links.push({
      label: t(loc, 'cards.record.plantingCard'),
      href: plantingCardHref(input.plantingId)
    });
  return {
    kind: 'harvest',
    key: recordCardKey('harvest', input.rowId),
    kicker: [t(loc, 'cards.record.harvest'), input.blockLabel].filter(Boolean).join(' · '),
    title: input.cropLabel,
    status: lockStatus(input.locked, loc),
    facts,
    sections,
    asOf: opts.now,
    provenance: [
      { source: 'manual', detail: t(loc, 'cards.record.provHarvest') },
      { source: 'data', detail: t(loc, 'cards.record.provRecord') }
    ],
    href: recordHref('harvest', input.rowId),
    notices: [copyNotice(loc)],
    links
  };
}

/** A live Planting or Equipment card shown under a record row: read-only,
 *  with a way back to the record it came from. */
export function frameLiveCard(
  card: CardModel,
  recordKind: string,
  rowId: string,
  locale?: string | null
): CardModel {
  const link = openRecordLink(recordKind, rowId, locale);
  return {
    ...card,
    links: [...(card.links ?? []).filter((l) => l.href !== link.href), link]
  };
}

export interface IrrigationRecordCardInput {
  rowId: string;
  occurredAt: number;
  areaLabel: string | null;
  bedLabel: string | null;
  inches: number | null;
  gallons: number | null;
  durationMin: number | null;
  method: string | null;
  notes: string | null;
  performerLabel: string | null;
}

export const IRRIGATION_RECORD_NOTICE =
  'A watering log. It is not a compliance record and can be removed if it was entered by mistake.';

/** Phase 32E (E4-14): a watering log's read-only card. */
export function buildIrrigationRecordCard(
  input: IrrigationRecordCardInput,
  opts: RecordCardOptions
): CardModel {
  const loc = opts.prefs.locale;
  const facts: CardFact[] = [
    {
      label: t(loc, 'cards.water.watered'),
      value: formatInstant(input.occurredAt, opts.prefs, 'datetime'),
      provenance: 'manual'
    }
  ];
  const amount =
    input.inches !== null
      ? `${trimNumber(input.inches, 2)} in`
      : input.gallons !== null
        ? `${trimNumber(input.gallons, 1)} gal`
        : input.durationMin !== null
          ? t(loc, 'cards.water.minutesOnly', { min: input.durationMin })
          : t(loc, 'cards.water.notLogged');
  facts.push({ label: t(loc, 'cards.water.amount'), value: amount, provenance: 'manual' });
  if (input.areaLabel)
    facts.push({ label: t(loc, 'cards.water.area'), value: input.areaLabel, provenance: 'data' });
  facts.push({
    label: t(loc, 'cards.task.where'),
    value: input.bedLabel ?? t(loc, 'cards.water.wholeArea'),
    provenance: 'data'
  });
  if (input.method)
    facts.push({ label: t(loc, 'cards.water.how'), value: input.method, provenance: 'manual' });
  if (input.performerLabel) {
    facts.push({
      label: t(loc, 'cards.water.loggedBy'),
      value: input.performerLabel,
      provenance: 'data'
    });
  }
  const sections: CardSection[] = input.notes?.trim()
    ? [{ title: t(loc, 'cards.notes'), items: [input.notes.trim()] }]
    : [];
  return {
    kind: 'irrigation',
    key: recordCardKey('irrigation', input.rowId),
    kicker: [t(loc, 'cards.area.watering'), input.areaLabel].filter(Boolean).join(' · '),
    title: input.bedLabel
      ? t(loc, 'cards.water.wateredBed', { bed: input.bedLabel })
      : t(loc, 'cards.water.watered'),
    facts,
    sections,
    asOf: opts.now,
    provenance: [{ source: 'manual', detail: t(loc, 'cards.water.provLog') }],
    href: recordHref('irrigation', input.rowId),
    notices: [t(loc, 'cards.water.notice')],
    links: [openRecordLink('irrigation', input.rowId, loc)]
  };
}
