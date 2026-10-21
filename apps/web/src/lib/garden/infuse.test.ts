import { describe, expect, it } from 'vitest';
import {
  INFUSE_OIL_DISCARD_DAYS,
  infuseMediaOf,
  infuseMethodLabel,
  infuseSafetyLine
} from './infuse';
import {
  bestPreservingRow,
  goalStatus,
  infuseGoalMedia,
  type PlantingSchedule,
  type PreservingRow
} from './harvestSchedule';
import { plantingGoalLines, type SnapshotPantry } from './pantrySnapshot';

const oilGood: PreservingRow = { method: 'infuse', suitability: 'good', medium: 'oil' };
const vinegarGood: PreservingRow = { method: 'infuse', suitability: 'good', medium: 'vinegar' };
const vinegarPoor: PreservingRow = { method: 'infuse', suitability: 'poor', medium: 'vinegar' };
const oilFair: PreservingRow = { method: 'infuse', suitability: 'fair', medium: 'oil' };

function planted(cropPluginId: string, cuts = 1): PlantingSchedule {
  return {
    plantingId: `p-${cropPluginId}`,
    cropPluginId,
    cuts: Array.from({ length: cuts }, () => ({
      plantingId: `p-${cropPluginId}`,
      cropPluginId,
      blockId: 'b',
      kind: 'window' as const,
      fromMs: 0,
      toMs: 1,
      week: '2026-06-01',
      provenance: 'plugin' as const
    })),
    endsAt: 'first-fall-frost',
    firstWindowOnly: true
  };
}

describe('infuse lines', () => {
  it('words each medium in both languages', () => {
    expect(infuseMethodLabel('oil')).toBe('Infused in oil');
    expect(infuseMethodLabel('vinegar', 'es')).toBe('En infusión en vinagre');
    expect(infuseSafetyLine('oil')).toContain(`${INFUSE_OIL_DISCARD_DAYS} days`);
    expect(infuseSafetyLine('oil')).toMatch(/botulism/);
    expect(infuseSafetyLine('vinegar')).toMatch(/store-bought vinegar/);
    expect(infuseSafetyLine('vinegar', 'es')).toMatch(/vinagre comprado/);
    expect(infuseSafetyLine('oil', 'es')).toContain(`${INFUSE_OIL_DISCARD_DAYS} días`);
  });

  it('lists the media a crop infuses in, oil first', () => {
    expect(infuseMediaOf([vinegarGood, oilGood, { method: 'dry', suitability: 'good' }])).toEqual([
      'oil',
      'vinegar'
    ]);
    expect(infuseMediaOf([vinegarPoor, oilGood], true)).toEqual(['oil']);
    expect(infuseMediaOf(undefined)).toEqual([]);
  });
});

describe('bestPreservingRow', () => {
  it('takes the better rated infuse row, vinegar on a tie', () => {
    expect(bestPreservingRow([vinegarPoor, oilFair], 'infuse')).toBe(oilFair);
    expect(bestPreservingRow([oilGood, vinegarGood], 'infuse')).toBe(vinegarGood);
    expect(bestPreservingRow([vinegarGood, oilGood], 'infuse')).toBe(vinegarGood);
    expect(bestPreservingRow([oilGood], 'dry')).toBeUndefined();
  });

  it('puts an infuse goal on track from the better of two rows', () => {
    const [line] = goalStatus([{ goal: 'infuse' }], [planted('herb')], {
      herb: { pluginId: 'herb', preserving: [vinegarPoor, oilFair] }
    });
    expect(line).toMatchObject({ status: 'on-track', suitability: 'fair', cropPluginId: 'herb' });
  });
});

describe('infuseGoalMedia (CO-10)', () => {
  const plantings = [
    { cropPluginId: 'basil', preserving: [oilGood, vinegarGood] },
    { cropPluginId: 'mint', preserving: [vinegarGood] }
  ];

  it('names the medium that puts the goal on track', () => {
    expect(
      infuseGoalMedia({ goal: 'infuse', status: 'on-track', cropPluginId: 'basil' }, plantings)
    ).toEqual(['vinegar']);
    expect(
      infuseGoalMedia({ goal: 'infuse', status: 'on-track', cropPluginId: 'rosemary' }, [
        { cropPluginId: 'rosemary', preserving: [oilGood] }
      ])
    ).toEqual(['oil']);
  });

  it('shows a line when the goal is not on track too', () => {
    expect(infuseGoalMedia({ goal: 'infuse', status: 'short' }, plantings)).toEqual([
      'oil',
      'vinegar'
    ]);
    expect(
      infuseGoalMedia({ goal: 'infuse', status: 'not-known' }, [{ cropPluginId: 'x' }])
    ).toEqual(['oil', 'vinegar']);
    expect(infuseGoalMedia({ goal: 'infuse', status: 'short' }, [plantings[1]])).toEqual([
      'vinegar'
    ]);
  });

  it('shows nothing for another goal', () => {
    expect(infuseGoalMedia({ goal: 'dry', status: 'not-known' }, plantings)).toEqual([]);
  });
});

describe('plantingGoalLines (CO-10)', () => {
  const pantry: SnapshotPantry = {
    year: 2026,
    goals: [
      {
        goal: 'dry',
        target: null,
        method: 'dry',
        status: 'on-track',
        reason: 'suitable-cut',
        cropPluginId: 'oregano-greek',
        suitability: 'good',
        provenance: 'plugin'
      },
      {
        goal: 'infuse',
        target: null,
        method: 'infuse',
        status: 'short',
        reason: 'no-cut',
        provenance: 'plugin'
      },
      {
        goal: 'can-or-jelly',
        target: null,
        method: null,
        status: 'not-known',
        reason: 'needs-recipe',
        provenance: 'fallback'
      }
    ],
    kept: []
  };
  const name = (id: string) => id;

  it('shows only the goals the herb can meet, with the safety line of each medium', () => {
    expect(
      plantingGoalLines(pantry, 'thyme-german-winter', name, null, [
        { method: 'dry', suitability: 'good' }
      ])
    ).toEqual(['Drying: On track. oregano-greek dries well.']);
    expect(
      plantingGoalLines(pantry, 'basil-genovese', name, null, [
        { method: 'dry', suitability: 'poor' },
        oilGood,
        vinegarGood
      ])
    ).toEqual([
      expect.stringMatching(/^Vinegars and oils: /),
      infuseSafetyLine('oil'),
      infuseSafetyLine('vinegar')
    ]);
  });

  it('shows nothing for a herb with no preserving data or a crop that is not a herb', () => {
    expect(plantingGoalLines(pantry, 'thyme-german-winter', name, null, undefined)).toEqual([]);
    expect(
      plantingGoalLines(pantry, 'tomato-amish-paste', name, null, [
        { method: 'dry', suitability: 'good' }
      ])
    ).toEqual([]);
    expect(plantingGoalLines(undefined, 'thyme-german-winter', name, null, [oilGood])).toEqual([]);
  });
});
