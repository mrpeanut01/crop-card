import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildAreaCard, buildAreaCards } from './area';
import { buildCard } from './index';
import { sampleSnapshot } from './fixtures';
import { formatSize } from './size';
import type { SnapshotArea, SnapshotAreaKind } from '../snapshot';

const fact = (card: ReturnType<typeof buildAreaCard>, label: string) =>
  card?.facts.find((f) => f.label === label);

describe('buildAreaCard', () => {
  const snap = sampleSnapshot();

  it('returns null for an unknown area', () => {
    expect(buildAreaCard(snap, 'nope')).toBeNull();
  });

  it('titles a garden with its name and puts kind + size in the kicker', () => {
    const card = buildAreaCard(snap, 'f_garden')!;
    expect(card.kind).toBe('area');
    expect(card.key).toBe('ar_f_garden');
    expect(card.href).toBe('/cards/area/ar_f_garden');
    expect(card.title).toBe('Kitchen Garden');
    expect(card.kicker).toBe('Garden · 30×40 ft');
    expect(fact(card, 'Size')).toEqual({ label: 'Size', value: '30×40 ft', provenance: 'manual' });
    expect(card.provenance).toContainEqual({ source: 'manual', detail: 'your dimensions' });
    expect(fact(card, 'Holds')?.value).toBe('2 beds · 1 container');
    expect(fact(card, 'Growing')?.value).toBe('1 planting');
    expect(fact(card, 'Planned')?.value).toBe('1');
  });

  it("lists what's in it now, planned, beds and notes", () => {
    const card = buildAreaCard(snap, 'f_garden')!;
    const section = (t: string) => card.sections.find((s) => s.title === t)?.items;
    expect(section('Growing now')).toEqual(['Cherokee Purple tomato · Bed 3']);
    expect(section('Planned')).toEqual(['Provider bush bean · Bed 1 · Jun 10']);
    expect(section('Beds')).toEqual(['Bed 1 · 4×8 ft', 'Bed 3 · 4×8 ft']);
    expect(section('Containers')).toEqual(['Container 2']);
    expect(section('Notes')).toEqual(['Drip on beds 1-3']);
  });

  it('next action covers tasks on its blocks and on its plantings', () => {
    expect(buildAreaCard(snap, 'f_garden')!.next?.label).toBe('Side-dress');
    expect(buildAreaCard(snap, 'f_hay')!.next).toEqual({
      label: 'First cutting',
      href: '/plan?block=b_hay#plan-scheduled-tasks',
      due: 'due Jun 20'
    });
  });

  it('shows acreage for big areas with data provenance', () => {
    const card = buildAreaCard(snap, 'f_hay')!;
    expect(card.title).toBe('Hayfield');
    expect(card.kicker).toBe('Pasture · 20 ac');
    expect(fact(card, 'Size')).toEqual({ label: 'Size', value: '20 ac', provenance: 'data' });
    expect(fact(card, 'Perimeter')?.value).toBe('3,900 ft');
    expect(fact(card, 'Holds')?.value).toBe('1 block');
  });

  it('names an unnamed non-crop area by its kind, never "{kind} area"', () => {
    const card = buildAreaCard(snap, 'f_barn')!;
    expect(card.title).toBe('Barn');
    expect(card.kicker).toBe('Barn · 40×60 ft');
    expect(fact(card, 'Growing')).toBeUndefined();
    const natural = buildAreaCard(
      sampleSnapshot({
        areas: [{ ...snap.areas[2], id: 'n', kind: 'natural_area', widthFt: null, lengthFt: null }]
      }),
      'n'
    )!;
    expect(natural.title).toBe('Woods / natural');
    expect(natural.kicker).toBe('Woods / natural');
  });

  it('marks a non-default kind as owner-picked (manual provenance)', () => {
    expect(buildAreaCard(snap, 'f_garden')!.provenance[0]).toEqual({
      source: 'manual',
      detail: 'kind picked by you'
    });
  });

  it('does not claim the owner picked the migrated default kind', () => {
    const s = sampleSnapshot();
    s.areas[0] = { ...s.areas[0], kind: 'field' };
    expect(buildAreaCard(s, 'f_hay')!.provenance).not.toContainEqual({
      source: 'manual',
      detail: 'kind picked by you'
    });
  });

  it('tags typed acres manual and map acres data', () => {
    const s = sampleSnapshot();
    s.areas[0] = { ...s.areas[0], acresSource: 'typed' };
    const typed = buildAreaCard(s, 'f_hay')!;
    expect(fact(typed, 'Size')?.provenance).toBe('manual');
    expect(typed.provenance).toContainEqual({ source: 'manual', detail: 'typed acres' });
    expect(typed.provenance).not.toContainEqual({ source: 'data', detail: 'your map' });
    expect(buildAreaCard(snap, 'f_hay')!.provenance).toContainEqual({
      source: 'data',
      detail: 'your map'
    });
  });

  it('buildCard dispatches by key and refuses unknown or unbuilt kinds', () => {
    expect(buildCard(snap, 'ar_f_garden')?.title).toBe('Kitchen Garden');
    expect(buildCard(snap, 'pl_p_tom')?.title).toBe('Cherokee Purple tomato');
    expect(buildCard(snap, 'sp_x')).toBeNull();
    expect(buildCard(snap, 'garbage')).toBeNull();
  });

  it('uses metres for metric users', () => {
    const card = buildAreaCard(snap, 'f_garden', { prefs: { timeZone: 'UTC', units: 'metric' } })!;
    expect(card.kicker).toBe('Garden · 9.1×12.2 m');
  });

  it('builds one card per area', () => {
    expect(buildAreaCards(snap)).toHaveLength(3);
  });
});

describe('copy rules (Phase 30 [term])', () => {
  const kinds: SnapshotAreaKind[] = [
    'field',
    'garden',
    'greenhouse',
    'orchard',
    'pasture',
    'barn',
    'residence',
    'natural_area',
    'water',
    'boundary'
  ];
  const areaArb: fc.Arbitrary<SnapshotArea> = fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    name: fc.constantFrom('', 'Hayfield', 'Back 40'),
    kind: fc.constantFrom(...kinds),
    acres: fc.option(fc.double({ min: 0, max: 5000, noNaN: true }), { nil: null }),
    widthFt: fc.option(fc.double({ min: 0, max: 5000, noNaN: true }), { nil: null }),
    lengthFt: fc.option(fc.double({ min: 0, max: 5000, noNaN: true }), { nil: null }),
    perimeterFt: fc.option(fc.double({ min: 0, max: 50000, noNaN: true }), { nil: null }),
    acresSource: fc.constantFrom(null, 'geometry', 'dimensions', 'typed'),
    notes: fc.constantFrom(null, 'n')
  });

  it('never labels a measurement "Area" and never says "area area" or "Location"', () => {
    fc.assert(
      fc.property(areaArb, (area) => {
        const card = buildAreaCard(sampleSnapshot({ areas: [area] }), area.id)!;
        const text = [
          card.kicker,
          card.title,
          ...card.facts.map((f) => `${f.label} ${f.value}`)
        ].join('\n');
        expect(card.facts.map((f) => f.label)).not.toContain('Area');
        expect(text).not.toMatch(/\barea area\b/i);
        expect(text).not.toMatch(/\b(Location|Place)s?\b/);
        expect(text).not.toMatch(/NaN|undefined/);
      })
    );
  });
});

describe('formatSize', () => {
  it('prefers dimensions under an acre and acres above', () => {
    expect(formatSize({ acres: null, widthFt: 4, lengthFt: 8 }, { units: 'us' })).toBe('4×8 ft');
    expect(formatSize({ acres: 3, widthFt: 400, lengthFt: 400 }, { units: 'us' })).toBe('3 ac');
    expect(formatSize({ acres: null, widthFt: 660, lengthFt: 660 }, { units: 'us' })).toBe('10 ac');
    expect(formatSize({ acres: null, widthFt: null, lengthFt: 8 }, { units: 'us' })).toBeNull();
    expect(formatSize({ acres: 0, widthFt: 0, lengthFt: 0 }, { units: 'us' })).toBeNull();
  });
});

describe('garden bed map', () => {
  it('gives a garden an Open designer link and a to-scale bed map for the card date', () => {
    const card = buildAreaCard(sampleSnapshot(), 'f_garden')!;
    expect(card.links).toEqual([{ label: 'Open designer', href: '/plan/areas/f_garden/design' }]);
    expect(card.bedMap).toMatchObject({ widthFt: 30, lengthFt: 40, hasNorth: false });
    const beds = card.bedMap!.beds;
    expect(beds.map((b) => b.name).sort()).toEqual(['', 'Bed 1', 'Bed 3']);
    expect(beds.find((b) => b.name === 'Bed 3')).toMatchObject({
      x: 14,
      y: 2,
      w: 8,
      l: 4,
      crops: ['Cherokee Purple tomato']
    });
    expect(beds.find((b) => b.name === 'Bed 1')!.crops).toEqual([]);
  });

  it('lists later plantings once the card date reaches them', () => {
    const card = buildAreaCard(sampleSnapshot(), 'f_garden', { now: Date.UTC(2026, 5, 20) })!;
    expect(card.bedMap!.beds.find((b) => b.name === 'Bed 1')!.crops).toEqual([
      'Provider bush bean'
    ]);
  });

  it('draws the bed map on the designer date without moving the card’s own date', () => {
    const snap = sampleSnapshot();
    const onMs = Date.UTC(2026, 5, 20);
    const card = buildAreaCard(snap, 'f_garden', { bedMapOnMs: onMs })!;
    expect(card.bedMap!.onMs).toBe(onMs);
    expect(card.bedMap!.beds.find((b) => b.name === 'Bed 1')!.crops).toEqual([
      'Provider bush bean'
    ]);
    expect(card.next).toEqual(buildAreaCard(snap, 'f_garden')!.next);
  });

  it('leaves pastures and barns without a designer', () => {
    for (const id of ['f_hay', 'f_barn']) {
      const card = buildAreaCard(sampleSnapshot(), id)!;
      expect(card.links).toBeUndefined();
      expect(card.bedMap).toBeUndefined();
    }
  });
});
