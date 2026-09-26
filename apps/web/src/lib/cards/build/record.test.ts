import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseRecordCardKey } from '../model';
import {
  OPEN_RECORD_LABEL,
  RECORD_COPY_NOTICE,
  buildScoutRecordCard,
  buildSprayRecordCard,
  frameLiveCard,
  type SprayRecordCardInput
} from './record';
import { SPRAY_RECHECK_NOTICE, SPRAY_REFERENCE_NOTICE } from './spray';
import { SAMPLE_FUNGICIDE, SAMPLE_HERBICIDE } from './fixturesGear';
import { buildPlantingCard } from './planting';
import { sampleSnapshot } from './fixtures';

const prefs = { timeZone: 'America/New_York', units: 'us' as const };
const NOW = Date.parse('2026-06-10T14:00:00Z');
const opts = { prefs, now: NOW };

function spray(overrides: Partial<SprayRecordCardInput> = {}): SprayRecordCardInput {
  return {
    recordKind: 'spray',
    rowId: 'ev-1',
    occurredAt: Date.parse('2026-06-01T13:30:00Z'),
    blockLabel: 'Block A',
    sprayerLabel: 'Boom 50',
    products: [
      {
        pluginId: '24d',
        displayName: '2,4-D Amine',
        rate: { amount: 16, unit: 'fl-oz' },
        label: SAMPLE_HERBICIDE
      }
    ],
    conditions: { windMph: 5, tempF: 72, provenance: 'measured' },
    observation: null,
    reEntryClearAt: null,
    preHarvestClearAt: null,
    rulesVersion: '0.5.6-issue130',
    performerLabel: 'sherry@example.com',
    locked: true,
    customRateOverride: false,
    ...overrides
  };
}

describe('buildSprayRecordCard', () => {
  it('shows what the record says, stamped with the rules it was saved under', () => {
    const card = buildSprayRecordCard(spray(), opts);
    expect(card.kind).toBe('spray');
    expect(card.title).toBe('2,4-D Amine');
    expect(card.kicker).toBe('Spray record · Block A');
    expect(card.rulesVersion).toBe('0.5.6-issue130');
    expect(card.status).toEqual({ label: 'Locked', tone: 'neutral' });
    const facts = Object.fromEntries(card.facts.map((f) => [f.label, f]));
    expect(facts['2,4-D Amine'].value).toBe('16 fl-oz/A');
    expect(facts['2,4-D Amine'].provenance).toBe('manual');
    expect(facts['EPA reg. no.'].value).toBe('34704-120');
    expect(facts['EPA reg. no.'].provenance).toBe('plugin');
    expect(facts['Sprayer'].value).toBe('Boom 50');
    expect(facts['Wind · temp'].provenance).toBe('manual');
    expect(facts['Recorded by'].value).toBe('sherry@example.com');
    expect(card.sections.find((s) => s.title === 'Mix order')?.items).toEqual(
      SAMPLE_HERBICIDE.mixSteps
    );
  });

  it('is a reference, never a clearance, and never offers to record', () => {
    const card = buildSprayRecordCard(spray(), opts);
    expect(card.notices).toEqual([SPRAY_REFERENCE_NOTICE, SPRAY_RECHECK_NOTICE, RECORD_COPY_NOTICE]);
    expect(card.next).toBeUndefined();
    expect(card.staleAfterMs).toBeUndefined();
    expect(card.links).toEqual([{ label: OPEN_RECORD_LABEL, href: '/records/spray/ev-1' }]);
    expect(card.href).toBe('/records/spray/ev-1');
    expect(parseRecordCardKey(card.key)).toEqual({ recordKind: 'spray', rowId: 'ev-1' });
  });

  it('marks default weather as fallback and custom rates as custom', () => {
    const card = buildSprayRecordCard(
      spray({
        conditions: { windMph: 3, tempF: 65, provenance: 'default' },
        customRateOverride: true,
        locked: false
      }),
      opts
    );
    expect(card.facts.find((f) => f.label === 'Wind · temp')?.provenance).toBe('fallback');
    expect(card.provenance.some((p) => p.source === 'fallback')).toBe(true);
    expect(card.facts.find((f) => f.label === '2,4-D Amine')?.value).toBe(
      '16 fl-oz/A, custom rate'
    );
    expect(card.status).toEqual({ label: 'Editable', tone: 'wheat' });
  });

  it('lists every product of a tank mix with its label facts, and survives a removed plugin', () => {
    const card = buildSprayRecordCard(
      spray({
        recordKind: 'fungicide',
        products: [
          { pluginId: 'copper-hydroxide', displayName: 'Copper hydroxide', rate: null, label: SAMPLE_FUNGICIDE },
          { pluginId: 'gone', displayName: 'gone', rate: { amount: 1, unit: 'pt' }, label: null }
        ],
        observation: 'Early blight · lesions = 4',
        reEntryClearAt: Date.parse('2026-06-03T13:30:00Z'),
        conditions: null
      }),
      opts
    );
    expect(card.kicker).toBe('Fungicide record · Block A');
    expect(card.title).toBe('Copper hydroxide, gone');
    expect(card.facts.find((f) => f.label === 'EPA reg. no.')).toBeUndefined();
    expect(card.facts.find((f) => f.label === 'Copper hydroxide')?.value).toBe('Rate not recorded');
    expect(card.sections.find((s) => s.title === 'Label facts')?.items).toEqual([
      'Copper hydroxide: EPA reg. no. not on file · REI 48 h · PHI 0 d',
      'gone: label facts not on file, check the label'
    ]);
    expect(card.sections.find((s) => s.title === 'Scouting')?.items).toEqual([
      'Early blight · lesions = 4'
    ]);
    expect(card.facts.some((f) => f.label === 'Re-entry clear')).toBe(true);
    expect(card.sections[0]).toMatchObject({ title: 'Before you spray again', safety: true });
  });

  it('property: any record id round-trips through the key and never carries a next action', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('spray', 'insecticide', 'fungicide' as const),
        fc.string({ minLength: 1 }),
        fc.boolean(),
        (recordKind, rowId, locked) => {
          const card = buildSprayRecordCard(
            spray({ recordKind: recordKind as SprayRecordCardInput['recordKind'], rowId, locked }),
            opts
          );
          expect(parseRecordCardKey(card.key)).toEqual({ recordKind, rowId });
          expect(card.next).toBeUndefined();
          expect(card.notices).toContain(SPRAY_REFERENCE_NOTICE);
        }
      )
    );
  });
});

describe('buildScoutRecordCard', () => {
  it('shows the observation, count, block and notes', () => {
    const card = buildScoutRecordCard(
      {
        rowId: 'sc-1',
        occurredAt: Date.parse('2026-06-02T12:00:00Z'),
        blockLabel: 'Bed 3',
        plantingLabel: 'Cherokee Purple',
        pest: 'Hornworm',
        metric: 'per_plant',
        value: 2,
        notes: '  Two on the north row  ',
        performerLabel: null,
        locked: false
      },
      opts
    );
    expect(card.kind).toBe('scout');
    expect(card.title).toBe('Hornworm');
    expect(card.kicker).toBe('Scout · Bed 3');
    expect(card.facts.map((f) => f.label)).toEqual(['Seen', 'Per plant', 'Block', 'Crop']);
    expect(card.sections).toEqual([{ title: 'Notes', items: ['Two on the north row'] }]);
    expect(card.provenance[0]).toEqual({ source: 'manual', detail: 'your observation' });
    expect(card.links?.[0].href).toBe('/records/scout/sc-1');
  });

  it('names a note-only observation plainly', () => {
    const card = buildScoutRecordCard(
      {
        rowId: 'sc-2',
        occurredAt: NOW,
        blockLabel: null,
        plantingLabel: null,
        pest: ' ',
        metric: '',
        value: 0,
        notes: null,
        performerLabel: null,
        locked: true
      },
      opts
    );
    expect(card.title).toBe('Scout note');
    expect(card.kicker).toBe('Scout');
    expect(card.sections).toEqual([]);
  });
});

describe('frameLiveCard', () => {
  it('adds one link back to the record and keeps the card otherwise intact', () => {
    const live = buildPlantingCard(sampleSnapshot(), 'p_tom')!;
    const framed = frameLiveCard(frameLiveCard(live, 'harvest', 'h1'), 'harvest', 'h1');
    expect(framed.links).toEqual([
      ...(live.links ?? []),
      { label: OPEN_RECORD_LABEL, href: '/records/harvest/h1' }
    ]);
    expect(framed.links?.some((l) => l.label === 'How to care for it')).toBe(true);
    expect({ ...framed, links: live.links }).toEqual(live);
  });
});
