import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  TOXIC_ADVICE,
  joinWords,
  pluralFrom,
  toxicCropsByArea,
  toxicFindings,
  toxicLines,
  toxicSection,
  toxicSummary,
  withToxicPlants,
  type ToxicCrop
} from './toxicAdjacency';
import type { CardModel } from '$lib/cards/model';

// Test values only; the shipped data lives in the crop plugins with sources.
const TOMATO: ToxicCrop = {
  pluginId: 'tomato-x',
  name: 'Tomato X',
  toxicity: [
    {
      speciesIds: ['dog', 'cat', 'horse'],
      parts: ['leaves', 'stems', 'unripe-fruit'],
      severity: 'toxic',
      note: 'Ripe fruit is not the problem.'
    }
  ]
};
const SORGHUM: ToxicCrop = {
  pluginId: 'sorghum-x',
  name: 'Sorghum X',
  toxicity: [{ speciesIds: ['goat', 'sheep'], parts: ['leaves'], severity: 'caution' }]
};
const ONION: ToxicCrop = {
  pluginId: 'onion-x',
  name: 'Onion X',
  toxicity: [
    { speciesIds: ['dog'], parts: ['whole-plant'], severity: 'highly-toxic' },
    { speciesIds: ['goat'], parts: ['leaves'], severity: 'caution' }
  ]
};
const plural = pluralFrom({
  dog: 'Dogs',
  cat: 'Cats',
  horse: 'Horses',
  goat: 'Goats',
  sheep: 'Sheep'
});

function card(sections: CardModel['sections'] = []): CardModel {
  return {
    kind: 'area',
    key: 'ar_1',
    kicker: 'Area',
    title: 'Back pasture',
    facts: [],
    sections,
    asOf: 0,
    provenance: [{ source: 'data' }],
    href: '/plan'
  };
}

describe('toxicFindings', () => {
  it('matches only the species that live there', () => {
    expect(toxicFindings([TOMATO, SORGHUM], ['goat'])).toEqual([
      {
        pluginId: 'sorghum-x',
        name: 'Sorghum X',
        speciesId: 'goat',
        parts: ['leaves'],
        severity: 'caution'
      }
    ]);
    expect(toxicFindings([TOMATO], ['chicken'])).toEqual([]);
    expect(toxicFindings(undefined, ['dog'])).toEqual([]);
    expect(toxicFindings([TOMATO], [])).toEqual([]);
  });

  it('keeps each entry per species and drops repeated species ids', () => {
    const f = toxicFindings([ONION], ['dog', 'goat', 'dog']);
    expect(f.map((x) => [x.speciesId, x.severity])).toEqual([
      ['dog', 'highly-toxic'],
      ['goat', 'caution']
    ]);
  });

  it('never reports a species a crop does not list (property)', () => {
    const species = ['dog', 'cat', 'horse', 'goat', 'sheep', 'chicken', 'pig'];
    fc.assert(
      fc.property(fc.subarray(species), fc.subarray([TOMATO, SORGHUM, ONION]), (ids, crops) => {
        for (const f of toxicFindings(crops, ids)) {
          expect(ids).toContain(f.speciesId);
          const crop = crops.find((c) => c.pluginId === f.pluginId)!;
          expect(crop.toxicity.some((t) => t.speciesIds.includes(f.speciesId))).toBe(true);
        }
      })
    );
  });
});

describe('summary and lines', () => {
  it('counts plants, not findings, in plain words', () => {
    expect(toxicSummary(toxicFindings([TOMATO], ['dog', 'cat']), plural)).toBe(
      '1 plant here can harm dogs and cats'
    );
    expect(toxicSummary(toxicFindings([SORGHUM, ONION], ['goat']), plural)).toBe(
      '2 plants here can harm goats'
    );
    expect(toxicSummary([], plural)).toBeNull();
  });

  it('lists parts, animals and the note per crop, most severe first', () => {
    expect(toxicLines(toxicFindings([ONION], ['goat', 'dog']), plural)).toEqual([
      'Onion X: All parts. Very poisonous to dogs. Can harm goats.'
    ]);
    expect(toxicLines(toxicFindings([TOMATO], ['horse']), plural)).toEqual([
      'Tomato X: Leaves, stems and unripe fruit. Poisonous to horses. Ripe fruit is not the problem.'
    ]);
  });

  it('joins words the plain-English way', () => {
    expect(joinWords([])).toBe('');
    expect(joinWords(['a'])).toBe('a');
    expect(joinWords(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('never uses an em dash in its own wording', () => {
    const f = toxicFindings([TOMATO, SORGHUM, ONION], ['dog', 'goat', 'sheep']);
    const text = [toxicSummary(f, plural), ...toxicLines(f, plural), TOXIC_ADVICE].join(' ');
    expect(text).not.toContain('—');
  });
});

describe('Card section', () => {
  it('is a collapsible, plugin-tagged safety section with the vet advice last', () => {
    const s = toxicSection(toxicFindings([SORGHUM], ['sheep']), plural)!;
    expect(s.title).toBe('1 plant here can harm sheep');
    expect(s.collapsible).toBe(true);
    expect(s.provenance).toBe('plugin');
    expect(s.safety).toBe(true);
    expect(s.englishOnly).toBe('all');
    expect(s.items.at(-1)).toBe(TOXIC_ADVICE);
  });

  it('goes right after Lives here and adds plugin provenance', () => {
    const out = withToxicPlants(
      card([
        { title: 'Grazing', items: ['x'] },
        { title: 'Lives here', items: ['Herd A'] },
        { title: 'In the ground', items: ['y'] }
      ]),
      [SORGHUM],
      ['goat'],
      plural
    );
    expect(out.sections.map((s) => s.title)).toEqual([
      'Grazing',
      'Lives here',
      '1 plant here can harm goats',
      'In the ground'
    ]);
    expect(out.provenance.map((p) => p.source)).toEqual(['data', 'plugin']);
  });

  it('leaves the card alone when nothing here harms the animals', () => {
    const c = card([{ title: 'Lives here', items: ['Hens'] }]);
    expect(withToxicPlants(c, [TOMATO], ['chicken'], plural)).toBe(c);
  });
});

describe('toxicCropsByArea', () => {
  it('groups by Area, one entry per plugin, only plugins with data', () => {
    const lookup = (id: string) =>
      id === 'tomato-x'
        ? { name: 'Tomato X', toxicity: TOMATO.toxicity }
        : id === 'lettuce'
          ? { name: 'Lettuce', toxicity: undefined }
          : null;
    expect(
      toxicCropsByArea(
        [
          { areaId: 'a', cropPluginId: 'tomato-x' },
          { areaId: 'a', cropPluginId: 'tomato-x' },
          { areaId: 'a', cropPluginId: 'lettuce' },
          { areaId: 'b', cropPluginId: 'lettuce' },
          { areaId: 'c', cropPluginId: 'gone' }
        ],
        lookup
      )
    ).toEqual({ a: [TOMATO] });
  });
});
