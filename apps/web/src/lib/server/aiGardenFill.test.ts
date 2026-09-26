import { describe, expect, it } from 'vitest';

import type { GardenCrop } from '$lib/garden/types';
import {
  buildGardenFillPrompt,
  parseGardenFillResponse,
  validateFillProposals,
  type FillValidationContext
} from './aiGardenFill';

const utc = (m: number, d: number) => Date.UTC(2027, m - 1, d);

const LETTUCE: GardenCrop = {
  pluginId: 'lettuce',
  displayName: 'Lettuce',
  cropFamily: 'leafy-green',
  archetype: 'cut-and-come-again-leafy',
  daysToMaturity: { min: 45, max: 55 },
  plantingGuide: { rowSpacingIn: 12, inRowSpacingIn: { min: 8, max: 10 } }
};
const TOMATO: GardenCrop = {
  pluginId: 'tomato',
  displayName: 'Tomato',
  cropFamily: 'solanaceae',
  archetype: 'continuous-harvest-fruit',
  daysToMaturity: { min: 70, max: 80 }
};

const window = { earliest: '2027-03-04', prime: '2027-03-18', latest: '2027-08-01', note: null };

function ctx(over: Partial<FillValidationContext> = {}): FillValidationContext {
  return {
    bed: { blockId: 'bed', widthFt: 4, lengthFt: 8 },
    crops: { lettuce: LETTUCE, tomato: TOMATO },
    lastSpringFrostMs: utc(4, 15),
    firstFallFrostMs: utc(10, 24),
    intervals: [],
    seasonYear: 2027,
    dateMs: utc(4, 1),
    plantingWindow: (id) =>
      id === 'lettuce'
        ? window
        : id === 'tomato'
          ? { earliest: '2027-04-22', prime: '2027-04-29', latest: '2027-07-01', note: null }
          : null,
    ...over
  };
}

const lettuce = (over: Record<string, unknown> = {}) => ({
  cropPluginId: 'lettuce',
  plantingDate: '2027-04-05',
  footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 24 },
  ...over
});

describe('validateFillProposals', () => {
  it('keeps a proposal that fits and tags it ai', () => {
    const [p] = validateFillProposals([lettuce({ note: '  Quick greens.  ' })], ctx());
    expect(p).toMatchObject({
      key: 'ai0',
      blockId: 'bed',
      cropPluginId: 'lettuce',
      varietyDisplayName: 'Lettuce',
      plantingDateMs: utc(4, 5),
      provenance: 'ai',
      plantCount: 8,
      note: 'Quick greens.',
      followsKey: null
    });
  });

  it('snaps footprints to 6 in and drops ones past the edge', () => {
    const kept = validateFillProposals(
      [
        lettuce({ footprint: { x_in: 1, y_in: 2, w_in: 47, l_in: 23 } }),
        lettuce({ footprint: { x_in: 0, y_in: 80, w_in: 48, l_in: 24 } })
      ],
      ctx()
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].footprint).toEqual({ x_in: 0, y_in: 0, w_in: 48, l_in: 24 });
  });

  it.each([
    ['an unknown crop', { cropPluginId: 'moon-melon' }],
    ['a date before the planting window', { cropPluginId: 'tomato', plantingDate: '2027-04-10' }],
    ['a date after the planting window', { plantingDate: '2027-09-01' }],
    ['a date before the chosen day', { plantingDate: '2027-03-20' }],
    ['a date in another year', { plantingDate: '2028-04-05' }],
    ['an impossible date', { plantingDate: '2027-02-30' }],
    ['a malformed footprint', { footprint: { x_in: -6, y_in: 0, w_in: 12, l_in: 12 } }],
    ['a missing footprint', { footprint: undefined }]
  ])('drops %s', (_label, over) => {
    expect(validateFillProposals([lettuce(over)], ctx())).toEqual([]);
  });

  it('drops a crop that cannot mature before the first fall frost', () => {
    expect(validateFillProposals([lettuce()], ctx({ firstFallFrostMs: utc(5, 1) }))).toEqual([]);
  });

  it('drops overlaps with existing plantings and with earlier kept proposals', () => {
    const existing = {
      cropId: 'c',
      blockId: 'bed',
      startMs: utc(3, 1),
      harvestStartMs: utc(5, 1),
      harvestEndMs: utc(6, 1),
      endMs: utc(6, 10),
      footprint: { x_in: 0, y_in: 72, w_in: 48, l_in: 24 },
      actual: false
    };
    const kept = validateFillProposals(
      [
        lettuce(),
        lettuce({ footprint: { x_in: 0, y_in: 12, w_in: 48, l_in: 24 } }),
        lettuce({ footprint: { x_in: 0, y_in: 72, w_in: 48, l_in: 24 } }),
        lettuce({
          footprint: { x_in: 0, y_in: 72, w_in: 48, l_in: 24 },
          plantingDate: '2027-06-10'
        }),
        lettuce({ footprint: { x_in: 0, y_in: 36, w_in: 48, l_in: 24 } })
      ],
      ctx({ intervals: [existing] })
    );
    expect(kept.map((k) => [k.key, k.footprint.y_in, k.plantingDateMs])).toEqual([
      ['ai0', 0, utc(4, 5)],
      ['ai1', 72, utc(6, 10)],
      ['ai2', 36, utc(4, 5)]
    ]);
  });

  it('keeps at most twelve', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      lettuce({ plantingDate: '2027-04-05', footprint: { x_in: 0, y_in: 0, w_in: 6, l_in: 6 }, i })
    ).map((p, i) => ({
      ...p,
      footprint: { x_in: (i % 8) * 6, y_in: Math.floor(i / 8) * 6, w_in: 6, l_in: 6 }
    }));
    expect(validateFillProposals(many, ctx())).toHaveLength(12);
  });
});

describe('parseGardenFillResponse', () => {
  it('reads fenced JSON', () => {
    expect(parseGardenFillResponse('```json\n{"proposals":[{"a":1}]}\n```')).toEqual([{ a: 1 }]);
  });

  it('returns null for prose or the wrong shape', () => {
    expect(parseGardenFillResponse('Plant lettuce.')).toBeNull();
    expect(parseGardenFillResponse('{"plantings":[]}')).toBeNull();
  });
});

describe('buildGardenFillPrompt', () => {
  it('states the bed, frost dates, occupancy and the allowed crops', () => {
    const text = buildGardenFillPrompt({
      bed: { name: 'Bed 2', widthFt: 4, lengthFt: 8 },
      seasonYear: 2027,
      dateIso: '2027-07-15',
      frost: { lastSpring: '2027-04-15', firstFall: '2027-10-24' },
      occupied: [
        {
          name: 'Tomato',
          fromIso: '2027-05-01',
          untilIso: '2027-11-03',
          footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 48 }
        }
      ],
      history: [{ year: 2026, name: 'Tomato', family: 'solanaceae' }],
      plannedCrops: [
        {
          cropPluginId: 'lettuce',
          name: 'Lettuce',
          family: 'leafy-green',
          daysToMaturity: { min: 45, max: 55 },
          inRowSpacingIn: 9,
          rowSpacingIn: 12,
          plants: 16
        }
      ],
      recipes: [
        {
          pluginId: 'salad-succession',
          name: 'Salad succession',
          description: 'Greens.',
          steps: ['lettuce -28 days from last spring frost']
        }
      ]
    });
    expect(text).toContain('48 in wide (x) by 96 in long (y)');
    expect(text).toContain('Average last spring frost: 2027-04-15. First fall frost: 2027-10-24.');
    expect(text).toContain('- Tomato: 2027-05-01 to 2027-11-03, x 0 in, y 0 in, 48×48 in');
    expect(text).toContain('- 2026: Tomato (solanaceae)');
    expect(text).toContain('wants 16 plants');
    expect(text).toContain('salad-succession: Salad succession.');
    expect(text).toContain('on or after 2027-07-15');
  });
});
