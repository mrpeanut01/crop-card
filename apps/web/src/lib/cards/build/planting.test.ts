import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildPlantingCard, buildPlantingCards, harvestWindow } from './planting';
import { sampleSnapshot } from './fixtures';
import { addDaysYmd, daysBetweenYmd } from './common';
import { parseCardKey } from '../model';
import type { FarmSnapshot, SnapshotPlanting } from '../snapshot';

const fact = (card: ReturnType<typeof buildPlantingCard>, label: string) =>
  card?.facts.find((f) => f.label === label);

describe('buildPlantingCard', () => {
  const snap = sampleSnapshot();

  it('returns null for an unknown planting', () => {
    expect(buildPlantingCard(snap, 'nope')).toBeNull();
  });

  it('builds the design-doc tomato card from plugin fields that exist', () => {
    const card = buildPlantingCard(snap, 'p_tom')!;
    expect(card.kind).toBe('planting');
    expect(card.key).toBe('pl_p_tom');
    expect(card.href).toBe('/cards/planting/pl_p_tom');
    expect(card.kicker).toBe('Planting · Bed 3 · Kitchen Garden');
    expect(card.title).toBe('Cherokee Purple tomato');
    expect(fact(card, 'Planted')).toEqual({ label: 'Planted', value: 'May 4', provenance: 'manual' });
    expect(fact(card, 'Harvest')).toEqual({
      label: 'Harvest',
      value: 'Jul 15 – Jul 23',
      provenance: 'plugin'
    });
    expect(fact(card, 'Day')?.value).toBe('28 of ~80');
    expect(fact(card, 'Spacing')).toEqual({
      label: 'Spacing',
      value: '18–24 in',
      provenance: 'plugin'
    });
    expect(fact(card, 'Row spacing')).toEqual({
      label: 'Row spacing',
      value: '48 in',
      provenance: 'plugin'
    });
    expect(fact(card, 'Plants')).toEqual({ label: 'Plants', value: '6', provenance: 'data' });
    expect(fact(card, 'PHI buffer')?.value).toBe('14 d · check labels after Jul 1');
    expect(card.asOf).toBe(snap.generatedAt);
    expect(card.rulesVersion).toBeUndefined();
  });

  it('picks the earliest open task as the one next action, overdue first', () => {
    const card = buildPlantingCard(snap, 'p_tom')!;
    expect(card.next).toEqual({
      label: 'Side-dress',
      href: '/today?task=t_side',
      due: 'overdue since May 30'
    });
    expect(card.sections.find((s) => s.title === 'Coming up')?.items).toEqual([
      'Stake + prune suckers (due Thu)',
      'Scout for hornworms (due Jun 12)'
    ]);
  });

  it('lists harvest cues from harvestIndicators', () => {
    const card = buildPlantingCard(snap, 'p_tom')!;
    expect(card.sections.find((s) => s.title === 'Harvest cues')?.items).toEqual([
      'Shoulders turn dusky purple',
      'Slight give when pressed'
    ]);
  });

  it('tags plugin provenance with the plugin id and version', () => {
    const card = buildPlantingCard(snap, 'p_tom')!;
    expect(card.provenance).toContainEqual({
      source: 'plugin',
      detail: 'tomato-cherokee-purple · v1.0.0'
    });
    expect(card.provenance.filter((p) => p.source === 'plugin')).toHaveLength(1);
  });

  it('a planned AI-scheduled planting reads "Sow" and keeps owner spacing as manual', () => {
    const card = buildPlantingCard(snap, 'p_bean')!;
    expect(fact(card, 'Sow')).toEqual({ label: 'Sow', value: 'Jun 10', provenance: 'ai' });
    expect(fact(card, 'Harvest')?.value).toBe('Jul 30');
    expect(fact(card, 'Spacing')).toEqual({ label: 'Spacing', value: '3 in', provenance: 'manual' });
    expect(fact(card, 'Row spacing')).toEqual({
      label: 'Row spacing',
      value: '18 in',
      provenance: 'manual'
    });
    expect(fact(card, 'Day')).toBeUndefined();
    expect(fact(card, 'PHI buffer')).toBeUndefined();
    expect(card.next).toBeUndefined();
  });

  it('degrades gracefully when the plugin is missing and there is no date', () => {
    const card = buildPlantingCard(snap, 'p_alf')!;
    expect(card.kicker).toBe('Planting · North cut · Hayfield');
    expect(fact(card, 'Sow')?.value).toBe('Not scheduled');
    expect(fact(card, 'Quantity')).toEqual({
      label: 'Quantity',
      value: '1,850 lb',
      provenance: 'manual'
    });
    expect(fact(card, 'Harvest')).toBeUndefined();
    expect(card.sections).toEqual([]);
  });

  it('shows the harvested date instead of a window once harvested', () => {
    const s = sampleSnapshot();
    s.plantings[0] = { ...s.plantings[0], status: 'harvested', harvestedAt: '2026-07-20' };
    const card = buildPlantingCard(s, 'p_tom')!;
    expect(fact(card, 'Harvested')).toEqual({
      label: 'Harvested',
      value: 'Jul 20',
      provenance: 'data'
    });
    expect(fact(card, 'Harvest')).toBeUndefined();
    expect(fact(card, 'PHI buffer')).toBeUndefined();
  });

  it('renders spacing in centimetres for metric users', () => {
    const card = buildPlantingCard(snap, 'p_tom', { prefs: { timeZone: 'UTC', units: 'metric' } })!;
    expect(fact(card, 'Spacing')?.value).toBe('45.7–61 cm');
    expect(fact(card, 'Row spacing')?.value).toBe('121.9 cm');
  });

  it('tags each spacing on its own: an owner in-row override keeps the plugin row spacing', () => {
    const s = sampleSnapshot();
    s.plantings[0] = { ...s.plantings[0], spacingIn: 6 };
    const card = buildPlantingCard(s, 'p_tom')!;
    expect(fact(card, 'Spacing')).toEqual({ label: 'Spacing', value: '6 in', provenance: 'manual' });
    expect(fact(card, 'Row spacing')).toEqual({
      label: 'Row spacing',
      value: '48 in',
      provenance: 'plugin'
    });
    expect(card.provenance).toContainEqual({
      source: 'plugin',
      detail: 'tomato-cherokee-purple · v1.0.0'
    });
  });

  it('keeps a fallback plant count tagged fallback and never invents manual', () => {
    const s = sampleSnapshot();
    s.plantings[0] = { ...s.plantings[0], plantCountProvenance: 'fallback' };
    expect(fact(buildPlantingCard(s, 'p_tom'), 'Plants')?.provenance).toBe('fallback');
    s.plantings[0] = { ...s.plantings[0], plantCountProvenance: null };
    expect(fact(buildPlantingCard(s, 'p_tom'), 'Plants')?.provenance).toBeUndefined();
  });

  it('an active, dated planting recorded by quantity has unique fact labels', () => {
    const s = sampleSnapshot();
    s.plantings[0] = { ...s.plantings[0], plantCount: null, quantityPlanted: 12, quantityUnit: null };
    const labels = buildPlantingCard(s, 'p_tom')!.facts.map((f) => f.label);
    expect(labels).toContain('Planted');
    expect(labels).toContain('Quantity');
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('computes due wording in the user time zone', () => {
    const s = sampleSnapshot({ generatedAt: Date.parse('2026-06-04T02:00:00Z') });
    const ny = buildPlantingCard(s, 'p_tom', { prefs: { timeZone: 'America/New_York', units: 'us' } })!;
    const tokyo = buildPlantingCard(s, 'p_tom', { prefs: { timeZone: 'Asia/Tokyo', units: 'us' } })!;
    expect(ny.sections[0].items[0]).toBe('Stake + prune suckers (due tomorrow)');
    expect(tokyo.sections[0].items[0]).toBe('Stake + prune suckers (due today)');
  });

  it('builds one card per planting', () => {
    expect(buildPlantingCards(snap).map((c) => c.key)).toEqual(['pl_p_tom', 'pl_p_bean', 'pl_p_alf']);
  });
});

describe('harvestWindow', () => {
  it('is null without a date or a days-to-maturity range', () => {
    expect(harvestWindow(null, { daysToMaturity: { min: 1, max: 2 } })).toBeNull();
    expect(harvestWindow('2026-05-01', {})).toBeNull();
    expect(harvestWindow('2026-05-01', undefined)).toBeNull();
    expect(harvestWindow('not-a-date', { daysToMaturity: { min: 1, max: 2 } })).toBeNull();
  });

  it('property: the window starts dtm.min days after planting and never ends before it starts', () => {
    const ymd = fc
      .date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2099-12-31T00:00:00Z'), noInvalidDate: true })
      .map((d) => d.toISOString().slice(0, 10));
    fc.assert(
      fc.property(ymd, fc.integer({ min: 1, max: 400 }), fc.integer({ min: 0, max: 200 }), (d, min, extra) => {
        const w = harvestWindow(d, { daysToMaturity: { min, max: min + extra } })!;
        expect(daysBetweenYmd(d, w.start)).toBe(min);
        expect(daysBetweenYmd(w.start, w.end)).toBe(extra);
        expect(addDaysYmd(d, min)).toBe(w.start);
      })
    );
  });
});

describe('planting builder properties', () => {
  const plantingArb: fc.Arbitrary<SnapshotPlanting> = fc.record({
    id: fc.string({ minLength: 1, maxLength: 12 }),
    blockId: fc.constantFrom('b_hay', 'b_bed1', 'b_bed3', 'b_gone'),
    cropPluginId: fc.constantFrom('tomato-cherokee-purple', 'bean-provider', 'missing'),
    varietyDisplayName: fc.string({ maxLength: 30 }),
    status: fc.constantFrom('planned', 'active', 'harvested'),
    plantingDate: fc.option(
      fc
        .date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-12-31T00:00:00Z'), noInvalidDate: true })
        .map((d) => d.toISOString().slice(0, 10)),
      { nil: null }
    ),
    harvestedAt: fc.constantFrom(null, '2026-08-01'),
    quantityPlanted: fc.option(fc.double({ min: 0, max: 1e6, noNaN: true }), { nil: null }),
    quantityUnit: fc.constantFrom(null, 'lb', 'seeds'),
    spacingIn: fc.option(fc.double({ min: 0.5, max: 120, noNaN: true }), { nil: null }),
    rowSpacingIn: fc.option(fc.double({ min: 0.5, max: 120, noNaN: true }), { nil: null }),
    plantCount: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: null }),
    plantCountProvenance: fc.constantFrom(null, 'data', 'manual', 'fallback'),
    sourceProvenance: fc.constantFrom(null, 'ai', 'fallback')
  }) as fc.Arbitrary<SnapshotPlanting>;

  it('never throws, round-trips its key and keeps every fact non-empty', () => {
    fc.assert(
      fc.property(plantingArb, fc.integer({ min: 0, max: 4_102_444_800_000 }), (p, now) => {
        const s: FarmSnapshot = sampleSnapshot({ plantings: [p] });
        const card = buildPlantingCard(s, p.id, { now })!;
        expect(card).not.toBeNull();
        expect(parseCardKey(card.key)).toEqual({ kind: 'planting', id: p.id });
        expect(card.title.length).toBeGreaterThan(0);
        const labels = card.facts.map((f) => f.label);
        expect(new Set(labels).size).toBe(labels.length);
        for (const f of card.facts) {
          expect(f.value.length).toBeGreaterThan(0);
          expect(f.value).not.toMatch(/NaN|undefined|null/);
        }
        for (const f of card.facts) {
          if (f.provenance) expect(card.provenance.some((pr) => pr.source === f.provenance)).toBe(true);
        }
      })
    );
  });
});
