import { describe, expect, it } from 'vitest';
import {
  computeYearAnimalSection,
  groupHeadAt,
  headCountText,
  type ComputeAnimalSectionInput,
  type GroupInput
} from './yearSummaryAnimals';

const Y0 = Date.UTC(2026, 0, 1);
const Y1 = Date.UTC(2027, 0, 1) - 1;
const DAY = 86_400_000;

function base(over: Partial<ComputeAnimalSectionInput> = {}): ComputeAnimalSectionInput {
  return {
    yearStartMs: Y0,
    yearEndMs: Y1,
    speciesName: (id) => ({ chicken: 'Chicken', goat: 'Goat' })[id] ?? 'Unknown species',
    animals: [],
    groups: [],
    doses: [],
    production: [],
    covered: [],
    ...over
  };
}

describe('groupHeadAt (B-51)', () => {
  const g: GroupInput = {
    id: 'g',
    speciesId: 'chicken',
    createdAtMs: Y0 - 100 * DAY,
    headCountNow: 10,
    events: [
      { status: 'died', atMs: Y0 + 30 * DAY, headCountDelta: -2 },
      { status: 'active', atMs: Y0 + 60 * DAY, headCountDelta: 4 },
      { status: 'sold', atMs: Y1 + 10 * DAY, headCountDelta: -3 }
    ]
  };
  it('walks the count back through later deltas', () => {
    expect(groupHeadAt(g, Y0 - 1)).toBe(11);
    expect(groupHeadAt(g, Y1)).toBe(13);
    expect(groupHeadAt(g, Y1 + 20 * DAY)).toBe(10);
  });
  it('is 0 before the group existed and null when the count is unknown', () => {
    expect(groupHeadAt(g, g.createdAtMs - 1)).toBe(0);
    expect(groupHeadAt({ ...g, headCountNow: null }, Y0)).toBeNull();
    expect(headCountText(null)).toBe('Count not known');
  });
});

describe('computeYearAnimalSection', () => {
  it('is null when no animal or group touches the year (B-53)', () => {
    expect(computeYearAnimalSection(base())).toBeNull();
    expect(
      computeYearAnimalSection(
        base({
          animals: [
            {
              id: 'a',
              speciesId: 'goat',
              arrivalMs: Y0 - 400 * DAY,
              departure: { status: 'sold', atMs: Y0 - 10 * DAY }
            }
          ]
        })
      )
    ).toBeNull();
    expect(
      computeYearAnimalSection(
        base({
          groups: [
            { id: 'g', speciesId: 'chicken', createdAtMs: Y1 + DAY, headCountNow: 3, events: [] }
          ]
        })
      )
    ).toBeNull();
  });

  it('counts named animals and unnamed head at the start and end of the year', () => {
    const s = computeYearAnimalSection(
      base({
        animals: [
          { id: 'a1', speciesId: 'goat', arrivalMs: Y0 - 50 * DAY, departure: null },
          {
            id: 'a2',
            speciesId: 'goat',
            arrivalMs: Y0 + 20 * DAY,
            departure: { status: 'slaughtered', atMs: Y0 + 200 * DAY }
          },
          {
            id: 'a3',
            speciesId: 'goat',
            arrivalMs: Y0 - 50 * DAY,
            departure: { status: 'died', atMs: Y0 + 5 * DAY }
          }
        ],
        groups: [
          {
            id: 'g',
            speciesId: 'chicken',
            createdAtMs: Y0 + 10 * DAY,
            headCountNow: 12,
            events: [{ status: 'culled', atMs: Y0 + 90 * DAY, headCountDelta: -3 }]
          }
        ]
      })
    )!;
    expect(s.headCounts).toEqual([
      { speciesId: 'chicken', atStart: 0, atEnd: 12 },
      { speciesId: 'goat', atStart: 2, atEnd: 1 }
    ]);
    const moves = Object.fromEntries(s.movements.map((m) => [`${m.speciesId}:${m.kind}`, m.head]));
    expect(moves).toEqual({
      'chicken:arrived': 15,
      'chicken:culled': 3,
      'goat:arrived': 1,
      'goat:slaughtered': 1,
      'goat:died': 1
    });
    expect(s.speciesNames).toEqual({ chicken: 'Chicken', goat: 'Goat' });
  });

  it('says "Count not known" for a group with no head count and a change with no delta', () => {
    const s = computeYearAnimalSection(
      base({
        groups: [
          {
            id: 'g',
            speciesId: 'chicken',
            createdAtMs: Y0 - DAY,
            headCountNow: null,
            events: [{ status: 'sold', atMs: Y0 + DAY, headCountDelta: null }]
          }
        ]
      })
    )!;
    expect(s.headCounts[0]).toEqual({ speciesId: 'chicken', atStart: null, atEnd: null });
    expect(s.movements).toEqual([
      { speciesId: 'chicken', kind: 'sold', label: 'Sold', head: null }
    ]);
  });

  it('a split is neither an arrival nor a loss of head (B-51)', () => {
    const flock: GroupInput = {
      id: 'flock',
      speciesId: 'chicken',
      createdAtMs: Y0 - 100 * DAY,
      headCountNow: 15,
      events: []
    };
    const split: GroupInput = {
      id: 'split',
      speciesId: 'chicken',
      createdAtMs: Y0 + 40 * DAY,
      headCountNow: 4,
      splitFrom: 'flock',
      events: [{ status: 'died', atMs: Y0 + 50 * DAY, headCountDelta: -1 }]
    };
    const s = computeYearAnimalSection(base({ groups: [flock, split] }))!;
    expect(s.headCounts).toEqual([{ speciesId: 'chicken', atStart: 20, atEnd: 19 }]);
    expect(s.movements).toEqual([{ speciesId: 'chicken', kind: 'died', label: 'Died', head: 1 }]);
    const unknown = computeYearAnimalSection(
      base({ groups: [flock, { ...split, headCountNow: null }] })
    )!;
    expect(unknown.headCounts[0].atStart).toBeNull();
  });

  it('rolls up treatments, production and covered declarations', () => {
    const s = computeYearAnimalSection(
      base({
        animals: [{ id: 'a', speciesId: 'goat', arrivalMs: Y0 - DAY, departure: null }],
        doses: [
          { product: 'Wormer', subject: 'Nanny' },
          { product: 'Wormer', subject: 'Billy' },
          { product: 'Wormer', subject: 'Nanny' },
          { product: 'Vaccine', subject: 'Nanny' }
        ],
        production: [
          { food: 'eggs', use: 'sale', useLabel: 'For sale', unit: 'dozen', quantity: 2.5 },
          { food: 'eggs', use: 'sale', useLabel: 'For sale', unit: 'dozen', quantity: 1 },
          { food: 'milk', use: 'food', useLabel: 'For the table', unit: 'gal', quantity: 3 }
        ],
        covered: [
          { atMs: Y0 + DAY, subject: 'Nanny', what: 'milk', use: 'For sale', basis: 'unknown' },
          { atMs: Y0 - DAY, subject: 'Nanny', what: 'milk', use: 'For sale', basis: 'known' }
        ]
      })
    )!;
    expect(s.treatments).toEqual([
      { product: 'Wormer', doses: 3, subjects: ['Billy', 'Nanny'] },
      { product: 'Vaccine', doses: 1, subjects: ['Nanny'] }
    ]);
    expect(s.production).toEqual([
      { food: 'eggs', use: 'sale', useLabel: 'For sale', unit: 'dozen', quantity: 3.5, logs: 2 },
      { food: 'milk', use: 'food', useLabel: 'For the table', unit: 'gal', quantity: 3, logs: 1 }
    ]);
    expect(s.covered).toHaveLength(1);
    expect(s.covered[0].basisText).toContain('not known');
  });
});
