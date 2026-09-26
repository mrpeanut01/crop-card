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

  it('shows an estimated zone as approximate with its station, never as the USDA map', () => {
    const card = buildFarmMapCard(
      sampleSnapshot({
        zone: {
          zone: '7a',
          provenance: 'data',
          stationName: 'Dulles Intl',
          distanceMi: 6.2,
          extremeMinF: 4.5
        }
      }),
      { prefs }
    );
    expect(card.facts.find((f) => f.label === 'Zone')).toEqual({
      label: 'Zone',
      value: '7a (approx.)',
      provenance: 'data'
    });
    expect(card.provenance).toContainEqual({
      source: 'data',
      detail: 'zone approx., from Dulles Intl · 6 mi'
    });
    expect(JSON.stringify(card)).not.toMatch(/usda/i);
  });

  it('shows a wide-radius estimate with its distance and a similar-elevation note', () => {
    const card = buildFarmMapCard(
      sampleSnapshot({
        zone: {
          zone: '6b',
          provenance: 'data',
          stationName: 'Great Basin NP, NV',
          distanceMi: 70.5,
          extremeMinF: -1.3,
          reach: 'wide',
          elevDeltaFt: -69
        }
      }),
      { prefs }
    );
    expect(card.facts.find((f) => f.label === 'Zone')).toEqual({
      label: 'Zone',
      value: '6b (approx., station 71 mi)',
      provenance: 'data'
    });
    expect(card.provenance).toContainEqual({
      source: 'data',
      detail: 'zone approx., from Great Basin NP, NV · 71 mi, similar elevation'
    });
    expect(JSON.stringify(card)).not.toMatch(/usda/i);
  });

  it('shows an owner-typed zone as manual and leaves the zone off when there is none', () => {
    const manual = buildFarmMapCard(
      sampleSnapshot({
        zone: { zone: '6b', provenance: 'manual', stationName: null, distanceMi: null, extremeMinF: null }
      }),
      { prefs }
    );
    expect(manual.facts.find((f) => f.label === 'Zone')).toEqual({
      label: 'Zone',
      value: '6b',
      provenance: 'manual'
    });
    expect(manual.provenance).toContainEqual({ source: 'manual', detail: 'your zone' });
    expect(buildFarmMapCard(sampleSnapshot({ zone: null }), { prefs }).facts.some((f) => f.label === 'Zone')).toBe(false);
    expect(buildFarmMapCard(sampleSnapshot(), { prefs }).facts.some((f) => f.label === 'Zone')).toBe(false);
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
