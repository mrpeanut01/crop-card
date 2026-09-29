import { describe, expect, it } from 'vitest';
import { cardKey, parseCardKey } from '../model';
import { barnPinKeys, buildFlockCard, buildFlockCards, memberCareLines } from './flock';
import { buildAreaCard, buildCard } from './index';
import { resolveOptions } from './common';
import { EGGS_CLEAR_MS, sampleAnimalSnapshot } from './fixturesAnimals';
import { sampleSnapshot } from './fixtures';

describe('Flock Card', () => {
  const snap = sampleAnimalSnapshot();

  it('uses the fl_ prefix and builds from /c short keys', () => {
    expect(cardKey('flock', 'g_layers')).toBe('fl_g_layers');
    expect(parseCardKey('fl_g_layers')).toEqual({ kind: 'flock', id: 'g_layers' });
    expect(buildCard(snap, 'fl_g_layers')?.kind).toBe('flock');
    expect(buildFlockCard(sampleSnapshot(), 'g_layers')).toBeNull();
    expect(buildFlockCards(sampleSnapshot())).toEqual([]);
  });

  it('names the flock by its species noun and shows the group total', () => {
    const card = buildFlockCard(snap, 'g_layers')!;
    expect(card.kicker).toBe('Chicken flock');
    expect(card.title).toBe('Layers');
    expect(card.facts.slice(0, 3)).toEqual([
      { label: 'How many', value: '22 chickens', provenance: 'data' },
      { label: 'Named', value: '2 named, 20 unnamed', provenance: 'data' },
      { label: 'Lives at', value: 'Barn', provenance: 'data' }
    ]);
    expect(card.facts).toContainEqual({ label: 'Food animals', value: 'Yes', provenance: 'data' });
    expect(card.href).toBe('/cards/flock/fl_g_layers');
  });

  it("shows the flock's own egg hold and points to members held on their own cards", () => {
    const card = buildFlockCard(snap, 'g_layers')!;
    expect(card.notices?.[0]).toBe('HOLD eggs until Wed, Jun 10, 2026');
    expect(card.notices).toContain('Also on hold on their own cards: Henrietta.');
    expect(card.status?.id).toBe('hold');
    const later = buildFlockCard(snap, 'g_layers', { now: EGGS_CLEAR_MS })!;
    expect(later.notices?.some((n) => n.startsWith('HOLD eggs'))).toBe(false);
  });

  it("can't confirm a clear flock while a member's treatment is unsynced", () => {
    const noHolds = sampleAnimalSnapshot({ animalHolds: [] });
    expect(buildFlockCard(noHolds, 'g_layers')!.status).toBeUndefined();
    const card = buildFlockCard(noHolds, 'g_layers', {
      unsyncedAnimalSubjects: new Set(['animal:a_hen2'])
    })!;
    expect(card.status?.id).toBe('unconfirmed');
  });

  it("rolls members' same care on the same day into one line after the flock's own plans", () => {
    const card = buildFlockCard(snap, 'g_layers')!;
    const care = card.sections.find((s) => s.title === 'Care due')!;
    expect(care.items).toEqual(['Deworm: due Wed', 'Mite check: 2 chickens, due Jun 10']);
    expect(care.provenance).toBe('manual');
    expect(card.next).toEqual({ label: 'Deworm', href: '/animals/groups/g_layers', due: 'due Wed' });
  });

  it('lists members in a folded Members (N) section and recent treatments', () => {
    const card = buildFlockCard(snap, 'g_layers')!;
    expect(card.sections.find((s) => s.title === 'Members (2)')?.items).toEqual([
      'Clucky',
      'Henrietta'
    ]);
    expect(card.sections.find((s) => s.title === 'Recent treatments')?.items[0]).toMatch(
      /^Wormer: Flock wormer, /
    );
    expect(card.links?.map((l) => l.label)).toEqual([
      'Call Dr. Lee',
      'Open flock page',
      'Health records',
      'Log eggs or milk'
    ]);
  });

  it('pins the Flock Card first, then every member, for the barn', () => {
    expect(barnPinKeys(snap, 'g_layers')).toEqual(['fl_g_layers', 'an_a_hen1', 'an_a_hen2']);
  });
});

describe('memberCareLines', () => {
  const opts = resolveOptions(sampleAnimalSnapshot());
  const plan = (id: string, title: string, due: string | null) => ({
    id,
    subjectType: 'animal' as const,
    subjectId: id,
    kind: 'deworm' as const,
    title,
    intervalDays: 30,
    nextDueAt: due ? Date.parse(due) : null,
    provenance: 'manual' as const
  });
  const goats = { label: 'Goats', displayName: 'Goat' };

  it('keeps different days and titles apart and names a lone member', () => {
    const lines = memberCareLines(
      [
        { plan: plan('1', 'Deworm', '2026-06-03T14:00:00Z'), memberName: 'Ada' },
        { plan: plan('2', 'Deworm', '2026-06-03T20:00:00Z'), memberName: 'Bea' },
        { plan: plan('3', 'Deworm', '2026-06-04T14:00:00Z'), memberName: 'Cy' },
        { plan: plan('4', 'Hoof trim', null), memberName: 'Dot' }
      ],
      goats,
      opts
    );
    expect(lines).toEqual([
      'Deworm: 2 goats, due Wed',
      'Deworm: Cy, due Thu',
      'Hoof trim: Dot, due date not set, ask your vet'
    ]);
  });
});

describe('offline Area Card with animals', () => {
  it('lists who lives there and the grazing hold from the snapshot', () => {
    const barn = buildAreaCard(sampleAnimalSnapshot(), 'f_barn')!;
    expect(barn.sections.find((s) => s.title === 'Lives here')?.items).toEqual([
      'Layers · 22 chickens · food animals'
    ]);
    expect(barn.facts).toContainEqual({ label: 'Animals', value: '22', provenance: 'data' });

    const hay = buildAreaCard(sampleAnimalSnapshot(), 'f_hay')!;
    expect(hay.sections.find((s) => s.title === 'Lives here')?.items).toEqual([
      'Nanny · Goat · food animal'
    ]);
    const grazing = hay.sections.find((s) => s.title === 'Grazing')!;
    expect(grazing.safety).toBe(true);
    expect(grazing.items).toEqual(['Grazing clear on Fri, Jun 5, 2026']);
  });

  it('is unchanged on a bundle with no animal data, as the live pages build it', () => {
    const plain = buildAreaCard(sampleSnapshot(), 'f_barn')!;
    expect(plain.sections.some((s) => s.title === 'Lives here')).toBe(false);
    const withHolds = buildAreaCard(
      sampleSnapshot({ areaHolds: sampleAnimalSnapshot().areaHolds }),
      'f_hay'
    )!;
    expect(withHolds.sections.some((s) => s.title === 'Grazing')).toBe(false);
  });

  it('drops a grazing hold once it has cleared', () => {
    const snap = sampleAnimalSnapshot();
    const hay = buildAreaCard(snap, 'f_hay', { now: Date.parse('2026-06-06T00:00:00Z') })!;
    expect(hay.sections.some((s) => s.title === 'Grazing')).toBe(false);
  });
});
