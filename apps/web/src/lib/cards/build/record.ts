/**
 * Phase 30G: read-only Cards for saved records on /records. The record is
 * the legal copy; these cards only show what it says, plus label facts
 * from the product plugin, and print with a QR back to the record.
 */

import { formatInstant, formatQuantity, type Prefs } from '$lib/prefs';
import {
  mergeProvenance,
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

export const RECORD_COPY_NOTICE = 'Read-only copy of a saved record. The record is the legal copy.';
export const OPEN_RECORD_LABEL = 'Open full record';

export type SprayRecordKind = 'spray' | 'insecticide' | 'fungicide';

const SPRAY_KIND_LABEL: Record<SprayRecordKind, string> = {
  spray: 'Spray record',
  insecticide: 'Insecticide record',
  fungicide: 'Fungicide record'
};

export interface SprayRecordProduct {
  pluginId: string;
  displayName: string;
  /** The rate saved on the record, if one was. */
  rate: { amount: number; unit: string } | null;
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

function openRecordLink(recordKind: string, rowId: string) {
  return { label: OPEN_RECORD_LABEL, href: recordHref(recordKind, rowId) };
}

function lockStatus(locked: boolean): CardModel['status'] {
  return locked ? { label: 'Locked', tone: 'neutral' } : { label: 'Editable', tone: 'wheat' };
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
  const facts: CardFact[] = [
    {
      label: 'Sprayed',
      value: formatInstant(input.occurredAt, prefs, 'datetime'),
      provenance: 'data'
    }
  ];
  if (input.blockLabel) facts.push({ label: 'Block', value: input.blockLabel, provenance: 'data' });
  if (input.sprayerLabel) {
    facts.push({ label: 'Sprayer', value: input.sprayerLabel, provenance: 'data' });
  }
  for (const p of input.products) {
    const rate = p.rate
      ? `${trimNumber(p.rate.amount, 2)} ${p.rate.unit}/A${input.customRateOverride ? ', custom rate' : ''}`
      : 'Rate not recorded';
    facts.push({ label: p.displayName, value: rate, provenance: 'manual' });
  }
  if (input.products.length === 1 && input.products[0].label) {
    facts.push({
      label: 'EPA reg. no.',
      value: input.products[0].label.epaRegistrationNumber ?? 'Not on file, check the label',
      provenance: 'plugin'
    });
  }
  if (input.conditions) {
    facts.push({
      label: 'Wind · temp',
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
      provenance: 'data'
    });
  }
  if (input.preHarvestClearAt) {
    facts.push({
      label: 'Harvest clear',
      value: formatInstant(input.preHarvestClearAt, prefs, 'month-day'),
      provenance: 'data'
    });
  }
  if (input.performerLabel) {
    facts.push({ label: 'Recorded by', value: input.performerLabel, provenance: 'data' });
  }

  const sections: CardSection[] = [];
  const labels = input.products.map((p) => p.label).filter((l): l is SnapshotSprayProduct => !!l);
  const safety = [...new Set(labels.flatMap((l) => beforeYouSpray(l)))];
  if (safety.length) sections.push({ title: 'Before you spray again', items: safety, safety: true });
  sections.push({ title: 'Label facts', items: input.products.map(labelLine) });
  if (input.observation) sections.push({ title: 'Scouting', items: [input.observation] });
  const mix = labels.flatMap((l) => l.mixSteps);
  if (mix.length) sections.push({ title: 'Mix order', items: mix });

  const provenance: CardProvenance[] = [
    { source: 'data', detail: 'your record' },
    ...labels.map((l) => ({ source: 'plugin' as const, detail: `${l.pluginId} · v${l.version}` }))
  ];
  if (input.conditions?.provenance === 'default') {
    provenance.push({ source: 'fallback', detail: 'default weather, not measured' });
  }

  const key = recordCardKey(input.recordKind, input.rowId);
  return {
    kind: 'spray',
    key,
    kicker: [SPRAY_KIND_LABEL[input.recordKind], input.blockLabel].filter(Boolean).join(' · '),
    title: input.products.map((p) => p.displayName).join(', ') || 'Spray',
    status: lockStatus(input.locked),
    facts,
    sections,
    asOf: opts.now,
    rulesVersion: input.rulesVersion,
    provenance: mergeProvenance(provenance),
    href: recordHref(input.recordKind, input.rowId),
    notices: [SPRAY_REFERENCE_NOTICE, SPRAY_RECHECK_NOTICE, RECORD_COPY_NOTICE],
    links: [openRecordLink(input.recordKind, input.rowId)]
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

function metricLabel(metric: string): string {
  const s = metric.replace(/[-_]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Count';
}

export function buildScoutRecordCard(
  input: ScoutRecordCardInput,
  opts: RecordCardOptions
): CardModel {
  const facts: CardFact[] = [
    {
      label: 'Seen',
      value: formatInstant(input.occurredAt, opts.prefs, 'datetime'),
      provenance: 'data'
    },
    { label: metricLabel(input.metric), value: trimNumber(input.value, 2), provenance: 'manual' }
  ];
  if (input.blockLabel) facts.push({ label: 'Block', value: input.blockLabel, provenance: 'data' });
  if (input.plantingLabel) {
    facts.push({ label: 'Crop', value: input.plantingLabel, provenance: 'data' });
  }
  if (input.performerLabel) {
    facts.push({ label: 'Scouted by', value: input.performerLabel, provenance: 'data' });
  }
  const sections: CardSection[] = input.notes?.trim()
    ? [{ title: 'Notes', items: [input.notes.trim()] }]
    : [];
  const key = recordCardKey('scout', input.rowId);
  return {
    kind: 'scout',
    key,
    kicker: ['Scout', input.blockLabel].filter(Boolean).join(' · '),
    title: input.pest.trim() || 'Scout note',
    status: lockStatus(input.locked),
    facts,
    sections,
    asOf: opts.now,
    provenance: [
      { source: 'manual', detail: 'your observation' },
      { source: 'data', detail: 'your record' }
    ],
    href: recordHref('scout', input.rowId),
    notices: [RECORD_COPY_NOTICE],
    links: [openRecordLink('scout', input.rowId)]
  };
}

/** A live Planting or Equipment card shown under a record row: read-only,
 *  with a way back to the record it came from. */
export function frameLiveCard(card: CardModel, recordKind: string, rowId: string): CardModel {
  const link = openRecordLink(recordKind, rowId);
  return {
    ...card,
    links: [...(card.links ?? []).filter((l) => l.href !== link.href), link]
  };
}
