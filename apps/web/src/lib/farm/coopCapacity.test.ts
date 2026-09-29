import { describe, expect, it } from 'vitest';
import { detailsFromDraft, detailsSummary, draftFromDetails } from './areaDetailsForm';
import { validateAreaDetails } from './areaKinds';
import {
  areaSqFt,
  defaultCoopSpecies,
  suggestCapacity,
  type CoopSpeciesOption
} from './coopCapacity';
import { acresForApi } from './sketch';

const chicken: CoopSpeciesOption = {
  id: 'chicken',
  name: 'Chicken',
  plural: 'chickens',
  indoorSqFt: 3.5,
  outdoorSqFt: 10,
  sourceName: 'eXtension Small and Backyard Poultry'
};
const goat: CoopSpeciesOption = {
  id: 'goat',
  name: 'Goat',
  plural: 'goats',
  indoorSqFt: 15,
  outdoorSqFt: null,
  sourceName: 'UMass Extension'
};
const dog: CoopSpeciesOption = {
  id: 'dog',
  name: 'Dog',
  plural: 'dogs',
  indoorSqFt: null,
  outdoorSqFt: null,
  sourceName: null
};

describe('suggestCapacity', () => {
  it('divides the floor by the indoor figure and rounds down', () => {
    const s = suggestCapacity({ option: chicken, space: 'indoor', areaSqFt: 40 });
    expect(s).toMatchObject({ ok: true, count: 11, sourceName: chicken.sourceName });
  });

  it('uses the run figure for an outdoor run', () => {
    expect(suggestCapacity({ option: chicken, space: 'outdoor', areaSqFt: 100 })).toMatchObject({
      ok: true,
      count: 10
    });
  });

  it('takes the smaller of shelter and run for both', () => {
    const s = suggestCapacity({
      option: chicken,
      space: 'both',
      areaSqFt: 999,
      shelterSqFt: 35,
      runSqFt: 60
    });
    expect(s).toMatchObject({ ok: true, count: 6 });
    if (s.ok) expect(s.basis).toContain('shelter');
  });

  it('asks for sizes, species or space when they are missing', () => {
    expect(suggestCapacity({ option: null, space: 'indoor', areaSqFt: 40 }).ok).toBe(false);
    expect(suggestCapacity({ option: chicken, space: null, areaSqFt: 40 }).ok).toBe(false);
    expect(suggestCapacity({ option: chicken, space: 'indoor', areaSqFt: null }).ok).toBe(false);
    const both = suggestCapacity({ option: chicken, space: 'both', areaSqFt: 40 });
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.reason).toMatch(/shelter and run/);
  });

  it('gives no suggestion for a species or space with no sourced figure', () => {
    const s = suggestCapacity({ option: goat, space: 'outdoor', areaSqFt: 400 });
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.reason).toMatch(/no sourced space figure for goats in a run/);
    expect(suggestCapacity({ option: dog, space: 'indoor', areaSqFt: 400 }).ok).toBe(false);
  });

  it('says so when the space is too small for one animal', () => {
    const s = suggestCapacity({ option: goat, space: 'indoor', areaSqFt: 10 });
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.reason).toMatch(/smaller than the guidance for one goat/);
  });

  it('never writes a figure without a source name', () => {
    const s = suggestCapacity({ option: chicken, space: 'indoor', areaSqFt: 7 });
    expect(s.ok && s.sourceName.length > 0).toBe(true);
  });
});

describe('areaSqFt', () => {
  it('prefers the drawn outline, then sketch dimensions', () => {
    const square = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [-77.5, 39.1],
          [-77.49995, 39.1],
          [-77.49995, 39.10004],
          [-77.5, 39.10004],
          [-77.5, 39.1]
        ]
      ]
    });
    expect(areaSqFt({ geometryGeojson: square, widthFt: 1, lengthFt: 1 })).toBeGreaterThan(100);
    expect(areaSqFt({ widthFt: 8, lengthFt: 10 })).toBe(80);
    expect(areaSqFt({})).toBeNull();
  });
});

describe('defaultCoopSpecies', () => {
  it('starts on who lives there, then backyard chickens from onboarding', () => {
    expect(defaultCoopSpecies({ housedSpeciesIds: ['duck'], farmAnimals: ['chickens'] })).toBe(
      'duck'
    );
    expect(defaultCoopSpecies({ farmAnimals: ['chickens'] })).toBe('chicken');
    expect(defaultCoopSpecies({ farmAnimals: ['pets'] })).toBeNull();
    expect(
      defaultCoopSpecies({ housedSpeciesIds: ['llama'], known: new Set(['chicken']) })
    ).toBeNull();
  });
});

describe('coop or pen details', () => {
  it('stores species, space, sizes, capacity and where the number came from', () => {
    const res = validateAreaDetails('coop_pen', {
      speciesId: 'chicken',
      space: 'both',
      shelterSqFt: 40,
      runSqFt: 120,
      capacity: 11,
      capacityProvenance: 'data'
    });
    expect(res.ok).toBe(true);
    expect(validateAreaDetails('coop_pen', { capacityProvenance: 'ai' }).ok).toBe(false);
    expect(validateAreaDetails('coop_pen', { capacity: 0 }).ok).toBe(false);
  });

  it('drops hidden sizes and round-trips the draft', () => {
    const draft = draftFromDetails('coop_pen', {
      speciesId: 'goat',
      space: 'indoor',
      capacity: 4,
      capacityProvenance: 'manual'
    });
    const out = detailsFromDraft('coop_pen', { ...draft, shelterSqFt: 30 });
    expect(out).toEqual({
      ok: true,
      details: { speciesId: 'goat', space: 'indoor', capacity: 4, capacityProvenance: 'manual' }
    });
  });

  it('summarizes the species by name and tags the capacity', () => {
    const rows = detailsSummary(
      'coop_pen',
      { speciesId: 'chicken', space: 'indoor', capacity: 11, capacityProvenance: 'data' },
      { chicken: 'Chicken' }
    );
    expect(rows).toEqual([
      { label: 'Animal type', value: 'Chicken' },
      { label: 'Is it indoors, a run, or both?', value: 'Indoor coop or shelter' },
      { label: 'Holds up to', value: '11 animals', provenance: 'data' }
    ]);
  });
});

describe('coop numbers for people (review)', () => {
  it('groups thousands in the suggestion basis', () => {
    const out = suggestCapacity({ option: chicken, space: 'indoor', areaSqFt: 236480 });
    expect(out).toMatchObject({ ok: true, count: 67565 });
    if (out.ok) expect(out.basis).toBe('3.5 sq ft each indoors, 236,480 sq ft in all');
  });

  it("names the coop's species and groups thousands on the card", () => {
    const rows = detailsSummary(
      'coop_pen',
      { speciesId: 'chicken', space: 'indoor', capacity: 67565, capacityProvenance: 'data' },
      { chicken: 'Chicken' },
      { chicken: 'chickens' }
    );
    expect(rows.at(-1)).toEqual({
      label: 'Holds up to',
      value: '67,565 chickens',
      provenance: 'data'
    });
  });
});

describe('acresForApi', () => {
  it('leaves out a shape too small to round above zero (#477)', () => {
    expect(acresForApi(0.0023)).toBeUndefined();
    expect(acresForApi(0.126)).toBe(0.13);
    expect(acresForApi(null)).toBeUndefined();
  });
});
