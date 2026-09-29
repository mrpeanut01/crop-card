import { describe, expect, it } from 'vitest';
import { cardKey, parseCardKey } from '../model';
import { buildAnimalCard, buildAnimalCards } from './animal';
import { buildCard, buildDeck } from './index';
import { sampleAnimalSnapshot } from './fixturesAnimals';
import { sampleSnapshot } from './fixtures';

const HOUR = 3_600_000;

describe('Animal Card keys', () => {
  it('uses the an_ prefix and round-trips through the card key parser', () => {
    expect(cardKey('animal', 'a_goat')).toBe('an_a_goat');
    expect(parseCardKey('an_a_goat')).toEqual({ kind: 'animal', id: 'a_goat' });
    expect(buildCard(sampleAnimalSnapshot(), 'an_a_goat')?.title).toBe('Nanny');
  });

  it('is null for an animal the snapshot does not have, or an older bundle', () => {
    expect(buildAnimalCard(sampleAnimalSnapshot(), 'nope')).toBeNull();
    expect(buildAnimalCard(sampleSnapshot(), 'a_goat')).toBeNull();
    expect(buildAnimalCards(sampleSnapshot())).toEqual([]);
  });
});

describe('Animal Card, farm layout', () => {
  const snap = sampleAnimalSnapshot();

  it('shows the kernel hold as the snapshot has it and never a clear from older spans', () => {
    const card = buildAnimalCard(snap, 'a_goat')!;
    expect(card.kicker).toBe('Goat');
    expect(card.notices).toEqual([
      'HOLD milk: end date not known. The owner can add the label or vet time when online.',
      expect.stringMatching(/^Holds as of /)
    ]);
    expect(card.status).toEqual({ id: 'hold', label: 'On hold', tone: 'rust' });
    expect(card.facts).toContainEqual({ label: 'Tag', value: 'G-7', provenance: 'manual' });
    expect(card.facts).toContainEqual({ label: 'Lives at', value: 'Hayfield', provenance: 'data' });
    expect(card.facts).toContainEqual({ label: 'Food animal', value: 'Yes', provenance: 'data' });
    expect(card.links?.map((l) => l.label)).toEqual([
      'Call Dr. Lee',
      'Open animal page',
      'Health records',
      'Log eggs or milk'
    ]);
    expect(card.links?.[0].href).toBe('tel:5405550100');
    expect(card.staleAfterMs).toBe(24 * HOUR);
  });

  it('reads a dated hold in the farm hold zone and folds a flock member under its flock', () => {
    const card = buildAnimalCard(snap, 'a_hen1')!;
    expect(card.kicker).toBe('Chicken · Layers');
    expect(card.parentKey).toBe('fl_g_layers');
    expect(card.notices?.[0]).toBe('HOLD meat until Sat, Jun 20, 2026');
    expect(card.facts).toContainEqual({ label: 'Lives at', value: 'Barn', provenance: 'data' });
    expect(card.sections.map((s) => s.title)).toEqual(['Care due', 'Flock care', 'Vet']);
    expect(card.sections[0].items).toEqual(['Mite check: due Jun 10']);
    expect(card.next).toEqual({ label: 'Mite check', href: '/animals/a_hen1', due: 'due Jun 10' });
  });

  it('drops a hold once its clear time has passed', () => {
    const card = buildAnimalCard(snap, 'a_hen1', { now: Date.parse('2026-06-20T05:00:00Z') })!;
    expect(card.notices?.some((n) => n.startsWith('HOLD'))).toBe(false);
    expect(card.status?.id).toBe('unconfirmed');
  });

  it('says no holds on file only while the snapshot is fresh and built under these rules', () => {
    const clear = buildAnimalCard(snap, 'a_hen2')!;
    expect(clear.notices).toEqual([expect.stringMatching(/^No holds on file as of /)]);
    expect(clear.status).toBeUndefined();

    const stale = buildAnimalCard(snap, 'a_hen2', { now: snap.generatedAt + 25 * HOUR })!;
    expect(stale.notices?.[0]).toMatch(/^Hold status not checked since .*, can't confirm\.$/);
    expect(stale.status).toEqual({ id: 'unconfirmed', label: "Can't confirm", tone: 'wheat' });

    const rules = buildAnimalCard(sampleAnimalSnapshot({ rulesVersion: '0.0.1' }), 'a_hen2')!;
    expect(rules.status?.id).toBe('unconfirmed');

    const noData = buildAnimalCard(sampleAnimalSnapshot({ animalHolds: undefined }), 'a_hen2')!;
    expect(noData.status?.id).toBe('unconfirmed');
  });

  it("can't confirm a clear reading while a treatment or move for it or its flock is unsynced", () => {
    const own = buildAnimalCard(snap, 'a_hen2', {
      unsyncedAnimalSubjects: new Set(['animal:a_hen2'])
    })!;
    expect(own.notices?.[0]).toMatch(/has not synced yet/);
    const viaFlock = buildAnimalCard(snap, 'a_hen2', {
      unsyncedAnimalSubjects: new Set(['group:g_layers'])
    })!;
    expect(viaFlock.status?.id).toBe('unconfirmed');
    const held = buildAnimalCard(snap, 'a_hen1', {
      unsyncedAnimalSubjects: new Set(['animal:a_hen1'])
    })!;
    expect(held.notices?.[0]).toBe('HOLD meat until Sat, Jun 20, 2026');
  });

  it('shows a prohibited drug as never for food, whatever else is held', () => {
    const card = buildAnimalCard(
      sampleAnimalSnapshot({
        animalHolds: [
          { subject: 'animal:a_goat', food: 'meat', fromMs: 1, clearMs: null, status: 'prohibited' },
          { subject: 'animal:a_goat', food: 'meat', fromMs: 1, clearMs: 9e15, status: 'held' }
        ]
      }),
      'a_goat'
    )!;
    expect(card.notices?.[0]).toBe('Never for food: meat');
    expect(card.status).toEqual({ id: 'never-for-food', label: 'Never for food', tone: 'rust' });
  });
});

describe('Animal Card, pet layout', () => {
  const snap = sampleAnimalSnapshot();

  it('leads with the next vaccine and food, and lists meds, the vet and the microchip', () => {
    const card = buildAnimalCard(snap, 'a_dog')!;
    expect(card.facts.slice(0, 3)).toEqual([
      { label: 'Kind', value: 'Dog', provenance: 'plugin' },
      { label: 'Next vaccine', value: 'Rabies, due Jun 15', provenance: 'plugin' },
      { label: 'Food', value: '2 cups twice a day', provenance: 'manual' }
    ]);
    expect(card.facts).toContainEqual({
      label: 'Microchip',
      value: '985112000123456',
      provenance: 'manual'
    });
    expect(card.facts.some((f) => f.label === 'Food animal')).toBe(false);
    expect(card.sections.find((s) => s.title === 'Care due')?.items).toEqual([
      'Rabies: due Jun 15',
      'Heartworm: due date not set, ask your vet'
    ]);
    expect(card.sections.find((s) => s.title === 'Medicine')?.items[0]).toMatch(/^Treatment: Ear drops, /);
    expect(card.sections.find((s) => s.title === 'Vet')?.items).toEqual(['Dr. Lee (Vet): 540-555-0100']);
    expect(card.links?.[0]).toEqual({ label: 'Call Dr. Lee', href: 'tel:5405550100' });
    expect(card.links?.some((l) => l.label === 'Log eggs or milk')).toBe(false);
  });

  it('shows no hold lines for a dog that never counted as a food animal', () => {
    const card = buildAnimalCard(snap, 'a_dog')!;
    expect(card.notices).toBeUndefined();
    expect(card.status).toBeUndefined();
  });

  it('never invents a vaccine date, and uses the pets layout for the whole farm', () => {
    const undated = sampleAnimalSnapshot({
      animalsLayout: 'pets',
      carePlans: [
        {
          id: 'cp',
          subjectType: 'animal',
          subjectId: 'a_goat',
          kind: 'vaccination',
          title: 'CDT',
          intervalDays: 365,
          nextDueAt: null,
          provenance: 'plugin'
        }
      ]
    });
    const card = buildAnimalCard(undated, 'a_goat')!;
    expect(card.facts[1]).toEqual({
      label: 'Next vaccine',
      value: 'Due date not set, ask your vet',
      provenance: 'plugin'
    });
    expect(card.facts.some((f) => f.label === 'Tag')).toBe(false);
    expect(card.next).toBeUndefined();
    expect(card.notices?.[0]).toMatch(/^HOLD milk/);
  });

  it('falls back to a contact whose role says vet, and shows none without one', () => {
    const byRole = buildAnimalCard(
      sampleAnimalSnapshot({
        emergencyContacts: [{ name: 'Valley Animal Hospital', role: 'Vet', phone: '540-555-0199' }]
      }),
      'a_dog'
    )!;
    expect(byRole.links?.[0].label).toBe('Call Valley Animal Hospital');
    const none = buildAnimalCard(sampleAnimalSnapshot({ emergencyContacts: [] }), 'a_dog')!;
    expect(none.sections.some((s) => s.title === 'Vet')).toBe(false);
    expect(none.links?.[0].label).toBe('Open animal page');
  });
});

describe('deck order', () => {
  it('puts Flock Cards before animal cards, after the farm map', () => {
    const kinds = buildDeck(sampleAnimalSnapshot()).map((c) => c.kind);
    const firstFlock = kinds.indexOf('flock');
    expect(firstFlock).toBeGreaterThan(kinds.indexOf('farmMap'));
    expect(kinds.indexOf('animal')).toBeGreaterThan(firstFlock);
    expect(kinds.filter((k) => k === 'animal')).toHaveLength(4);
  });
});
