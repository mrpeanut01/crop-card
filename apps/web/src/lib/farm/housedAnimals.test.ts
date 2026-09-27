import { describe, expect, it } from 'vitest';
import type { CardModel } from '$lib/cards/model';
import {
  animalLabel,
  capacityLabel,
  housedLines,
  housingFacts,
  housingSection,
  withHousing,
  type AreaHousing,
  type HousedAnimalRow
} from './housedAnimals';

const layers = {
  id: 'g1',
  name: 'Layers',
  speciesPlural: 'Chickens',
  total: 24,
  foodProducing: true
};

const daisy: HousedAnimalRow = {
  id: 'a1',
  name: 'Daisy',
  tag: '14',
  speciesName: 'Cattle',
  purpose: 'production',
  foodProducing: true
};

const tagOnly: HousedAnimalRow = { ...daisy, id: 'a2', name: null, tag: '22' };
const rex: HousedAnimalRow = {
  id: 'a3',
  name: null,
  tag: '7',
  speciesName: 'Dog',
  purpose: 'pet',
  foodProducing: false
};

const housing = (over: Partial<AreaHousing> = {}): AreaHousing => ({
  groups: [layers],
  animals: [daisy],
  total: 25,
  capacity: null,
  ...over
});

const card: CardModel = {
  kind: 'area',
  key: 'ar_x',
  kicker: 'Coop or pen',
  title: 'Hen House',
  facts: [{ label: 'Size', value: '10 × 12 ft' }],
  sections: [{ title: 'Notes', items: ['Fox-proof door'] }],
  asOf: 0,
  provenance: [{ source: 'manual', detail: 'kind picked by you' }],
  href: '/cards/area/ar_x'
};

describe('housed animals on the Area Card', () => {
  it('lists groups with their total and individuals by name, with the food chip', () => {
    expect(housedLines(housing())).toEqual([
      'Layers · 24 chickens · food animals',
      'Daisy · Cattle · food animal'
    ]);
  });

  it('shows a tag only outside the pets layout and never for a pet', () => {
    expect(animalLabel(tagOnly)).toBe('Tag 22');
    expect(animalLabel(tagOnly, { petsLayout: true })).toBe('Cattle');
    expect(animalLabel(rex)).toBe('Dog');
    expect(housedLines(housing({ groups: [], animals: [rex] }))).toEqual(['Dog']);
  });

  it('keeps the food chip in the pets layout', () => {
    const lines = housedLines(housing({ animals: [tagOnly] }), { petsLayout: true });
    expect(lines).toEqual(['Layers · 24 chickens · food animals', 'Cattle · food animal']);
  });

  it('never says livestock and uses no long dashes', () => {
    const text = housedLines(housing({ animals: [daisy, tagOnly, rex] })).join('\n');
    expect(text).not.toMatch(/livestock|[–—]/i);
  });

  it('reports capacity and flags going over it without blocking anything', () => {
    expect(capacityLabel({ capacity: 24, count: 20, over: false })).toBe('20 of 24');
    expect(capacityLabel({ capacity: 24, count: 26, over: true })).toBe('Over capacity (26 of 24)');
    expect(
      housingFacts(housing({ total: 26, capacity: { capacity: 24, count: 26, over: true } }))
    ).toEqual([
      { label: 'Animals', value: '26', provenance: 'data' },
      { label: 'Capacity', value: 'Over capacity (26 of 24)', provenance: 'manual' }
    ]);
  });

  it('shows capacity on an empty coop', () => {
    const empty = housing({
      groups: [],
      animals: [],
      total: 0,
      capacity: { capacity: 12, count: 0, over: false }
    });
    expect(housingFacts(empty)).toEqual([
      { label: 'Capacity', value: '0 of 12', provenance: 'manual' }
    ]);
    expect(housingSection(empty)).toBeNull();
  });

  it('caps the list and says how many more', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      ...daisy,
      id: `a${i}`,
      name: `Cow ${i}`
    }));
    const section = housingSection(housing({ groups: [], animals: many, total: 11 }))!;
    expect(section.items).toHaveLength(9);
    expect(section.items.at(-1)).toBe('+3 more');
  });

  it('adds a Lives here section first and keeps the rest of the card', () => {
    const out = withHousing(card, housing());
    expect(out.sections.map((s) => s.title)).toEqual(['Lives here', 'Notes']);
    expect(out.facts.map((f) => f.label)).toEqual(['Size', 'Animals']);
    expect(out.provenance).toEqual([
      { source: 'manual', detail: 'kind picked by you' },
      { source: 'data' }
    ]);
  });

  it('leaves the card alone when nobody lives there', () => {
    expect(withHousing(card, null)).toBe(card);
    expect(withHousing(card, housing({ groups: [], animals: [], total: 0 }))).toBe(card);
  });
});
