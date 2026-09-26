import { describe, expect, it } from 'vitest';
import { buildCard, buildFarmMapCard } from './index';
import { sampleSnapshot } from './fixtures';
import { cardKey } from '../model';
import type { SnapshotFrostDates } from '../snapshot';

const prefs = { timeZone: 'America/New_York', units: 'us' as const };

const frost = (over: Partial<SnapshotFrostDates> = {}): SnapshotFrostDates => ({
  lastSpring: '04-15',
  firstFall: '10-24',
  hardLastSpring: '03-28',
  hardFirstFall: '11-08',
  cautious: null,
  frostFree: false,
  provenance: 'data',
  stationName: 'Dulles Intl',
  distanceMi: 6.2,
  ...over
});

describe('buildFarmMapCard', () => {
  it('lists Areas by kind with sizes and a legend', () => {
    const card = buildFarmMapCard(sampleSnapshot(), { prefs });
    expect(card.kind).toBe('farmMap');
    expect(card.key).toBe(cardKey('farmMap', 'owner_a'));
    expect(card.title).toBe('Goose Creek');
    expect(card.kicker).toBe('Farm map · 3 areas');
    expect(card.sections.map((s) => s.title)).toEqual(['Gardens', 'Pastures', 'Barns', 'Legend']);
    expect(card.sections[0].items).toEqual(['Kitchen Garden · 30×40 ft']);
    expect(card.sections[1].items).toEqual(['Hayfield · 20 ac']);
    expect(card.sections[2].items).toEqual(['Barn · 40×60 ft']);
    expect(card.sections[3].items).toEqual([
      'Garden: sage',
      'Pasture: wheat gold',
      'Barn: rust red'
    ]);
    expect(card.facts.find((f) => f.label === 'Areas')?.value).toBe('3');
    expect(card.facts.find((f) => f.label === 'Growing size')?.value).toMatch(/^20\.0?\d* ac$/);
  });

  it('shows frost dates with their source', () => {
    const card = buildFarmMapCard(sampleSnapshot({ frost: frost() }), { prefs });
    expect(card.facts.find((f) => f.label === 'Last frost')).toEqual({
      label: 'Last frost',
      value: 'Apr 15',
      provenance: 'data'
    });
    expect(card.facts.find((f) => f.label === 'First frost')?.value).toBe('Oct 24');
    expect(card.facts.find((f) => f.label === 'Hard frost')?.value).toBe('Mar 28 · Nov 8');
    expect(card.provenance).toContainEqual({ source: 'data', detail: 'Dulles Intl, 6 mi' });
  });

  it('labels fallback and frost-free climates honestly', () => {
    const fb = buildFarmMapCard(
      sampleSnapshot({ frost: frost({ provenance: 'fallback', stationName: null, hardLastSpring: null }) }),
      { prefs }
    );
    expect(fb.facts.find((f) => f.label === 'Last frost')?.provenance).toBe('fallback');
    expect(fb.facts.some((f) => f.label === 'Hard frost')).toBe(false);
    expect(fb.provenance).toContainEqual({ source: 'fallback', detail: 'Loudoun defaults' });

    const warm = buildFarmMapCard(sampleSnapshot({ frost: frost({ frostFree: true }) }), { prefs });
    expect(warm.facts.find((f) => f.label === 'Frost')?.value).toBe('Frost-free');
    expect(warm.facts.some((f) => f.label === 'Last frost')).toBe(false);
  });

  it('adds emergency contacts only when some are saved', () => {
    const none = buildFarmMapCard(sampleSnapshot(), { prefs });
    expect(none.sections.some((s) => s.title === 'Emergency contacts')).toBe(false);
    const some = buildFarmMapCard(sampleSnapshot(), {
      prefs,
      emergencyContacts: [
        { label: 'Poison control', phone: '800-222-1222' },
        { label: ' ', phone: '911' }
      ]
    });
    expect(some.sections[0]).toEqual({
      title: 'Emergency contacts',
      items: ['Poison control: 800-222-1222']
    });
  });

  it('handles an empty farm and caps long lists', () => {
    const empty = buildFarmMapCard(sampleSnapshot({ areas: [], farmName: null }), { prefs });
    expect(empty.title).toBe('Your farm');
    expect(empty.kicker).toBe('Farm map · 0 areas');
    expect(empty.sections).toEqual([{ title: 'Areas', items: ['Nothing on the map yet.'] }]);

    const many = sampleSnapshot({
      areas: Array.from({ length: 9 }, (_, i) => ({
        id: `f${i}`,
        name: `Field ${i + 1}`,
        kind: 'field' as const,
        acres: 1,
        widthFt: null,
        lengthFt: null,
        perimeterFt: null,
        acresSource: 'typed' as const,
        notes: null
      }))
    });
    const card = buildFarmMapCard(many, { prefs });
    expect(card.sections[0].items).toHaveLength(7);
    expect(card.sections[0].items.at(-1)).toBe('+3 more');
  });

  it('is reachable through buildCard only for its own Owner', () => {
    const snap = sampleSnapshot();
    expect(buildCard(snap, cardKey('farmMap', 'owner_a'))?.kind).toBe('farmMap');
    expect(buildCard(snap, cardKey('farmMap', 'owner_b'))).toBeNull();
  });
});

describe('buildFarmMapCard lines and points', () => {
  const features = [
    {
      id: 'mf-1',
      kind: 'fence' as const,
      name: 'Pasture fence',
      fieldId: null,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [-77.55, 39.1],
          [-77.549, 39.1]
        ] as Array<[number, number]>
      },
      details: null,
      lengthFt: 283
    },
    {
      id: 'mf-2',
      kind: 'water_source' as const,
      name: 'Barn well',
      fieldId: null,
      geometry: { type: 'Point' as const, coordinates: [-77.55, 39.1] as [number, number] },
      details: { source: 'well' as const, flowRateGpm: 12 },
      lengthFt: null
    },
    {
      id: 'mf-3',
      kind: 'gate' as const,
      name: 'Lane gate',
      fieldId: null,
      geometry: { type: 'Point' as const, coordinates: [-77.551, 39.1] as [number, number] },
      details: null,
      lengthFt: null
    }
  ];

  it('lists them by kind after the Areas and adds them to the legend', () => {
    const card = buildFarmMapCard(sampleSnapshot({ mapFeatures: features }), { prefs });
    expect(card.sections.map((s) => s.title)).toEqual([
      'Gardens',
      'Pastures',
      'Barns',
      'Fences',
      'Gates',
      'Water sources',
      'Legend'
    ]);
    expect(card.sections.find((s) => s.title === 'Fences')?.items).toEqual([
      'Pasture fence · 283 ft'
    ]);
    expect(card.sections.find((s) => s.title === 'Water sources')?.items).toEqual([
      'Barn well · Well, 12 gal/min'
    ]);
    const legend = card.sections.find((s) => s.title === 'Legend')!.items;
    expect(legend).toContain('Fence: brown line');
    expect(legend).toContain('Gate: brown dot marked G');
    expect(legend).toContain('Water source: blue dot marked W');
    expect(card.facts.find((f) => f.label === 'Areas')?.value).toBe('3');
  });

  it('uses metric lengths for metric households', () => {
    const card = buildFarmMapCard(sampleSnapshot({ mapFeatures: features }), {
      prefs: { ...prefs, units: 'metric' }
    });
    expect(card.sections.find((s) => s.title === 'Fences')?.items).toEqual([
      'Pasture fence · 86 m'
    ]);
  });

  it('is unchanged for bundles saved before lines and points existed', () => {
    const before = buildFarmMapCard(sampleSnapshot(), { prefs });
    const empty = buildFarmMapCard(sampleSnapshot({ mapFeatures: [] }), { prefs });
    expect(empty.sections).toEqual(before.sections);
  });

  it('shows lines and points even before any Area is drawn', () => {
    const card = buildFarmMapCard(sampleSnapshot({ areas: [], mapFeatures: features }), { prefs });
    expect(card.sections.some((s) => s.items.includes('Nothing on the map yet.'))).toBe(false);
    expect(card.sections.find((s) => s.title === 'Legend')?.items).toHaveLength(3);
  });
});
