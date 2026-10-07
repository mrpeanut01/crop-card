import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  activeIngredientNames,
  cropTreated,
  lockedNow,
  modeOfActionLabels,
  recordedTarget,
  reiHoursFor,
  reiText
} from './exportFacts';

const HOUR = 3_600_000;

describe('activeIngredientNames (#760)', () => {
  it('reads the label ingredient names, never the MoA group', () => {
    expect(
      activeIngredientNames({
        type: 'fungicide',
        activeIngredients: [{ name: 'tebuconazole' }]
      })
    ).toBe('tebuconazole');
    expect(
      activeIngredientNames({
        activeIngredients: [
          { name: 'lambda-cyhalothrin' },
          { name: ' ' },
          { name: 'lambda-cyhalothrin' }
        ]
      })
    ).toBe('lambda-cyhalothrin');
  });

  it('is blank when the product is not in the library', () => {
    expect(activeIngredientNames(undefined)).toBe('');
  });
});

describe('modeOfActionLabels', () => {
  it('labels IRAC and FRAC groups and leaves herbicide classes as they are', () => {
    expect(modeOfActionLabels('insecticide', ['3A'])).toEqual(['IRAC 3A']);
    expect(modeOfActionLabels('fungicide', ['3', '3', ' 11 '])).toEqual(['FRAC 3', 'FRAC 11']);
    expect(modeOfActionLabels('herbicide', ['synthetic-auxin'])).toEqual(['synthetic-auxin']);
  });
});

describe('reiHoursFor', () => {
  it('prefers the clear time stored on the record', () => {
    expect(reiHoursFor(0, 12 * HOUR, [4])).toBe(12);
  });

  it('uses the longest library value only when every product has one', () => {
    expect(reiHoursFor(0, undefined, [4, 24])).toBe(24);
    expect(reiHoursFor(0, undefined, [4, undefined])).toBeUndefined();
    expect(reiHoursFor(0, undefined, [])).toBeUndefined();
  });

  it('never invents a value: unknown inputs give "Not on file"', () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.integer({ min: 0, max: 200 }), { nil: undefined })),
        (hs) => {
          const out = reiHoursFor(1_000, undefined, hs);
          if (hs.length === 0 || hs.some((h) => h === undefined)) expect(out).toBeUndefined();
          else expect(out).toBe(Math.max(...(hs as number[])));
        }
      )
    );
    expect(reiText(undefined)).toBe('Not on file');
    expect(reiText(12)).toBe('12 h');
  });
});

describe('recordedTarget', () => {
  it('uses only what was recorded', () => {
    expect(recordedTarget({ scoutObservation: { pest: 'potato leafhopper' } })).toBe(
      'potato leafhopper'
    );
    expect(recordedTarget({ diseaseObservation: { disease: 'Fusarium head blight' } })).toBe(
      'Fusarium head blight'
    );
    expect(recordedTarget({})).toBe('');
  });
});

describe('cropTreated', () => {
  const plantings = [
    { id: 'c1', cropPluginId: 'wheat', varietyDisplayName: 'Wheat' },
    { id: 'c2', cropPluginId: 'alfalfa', varietyDisplayName: 'Alfalfa' }
  ];
  const nameOf = (id: string) => (id === 'wheat' ? 'Winter wheat' : undefined);

  it("names the record's own planting", () => {
    expect(cropTreated('c1', plantings, nameOf)).toBe('Winter wheat');
    expect(cropTreated('c2', plantings, nameOf)).toBe('Alfalfa');
  });

  it("falls back to the block's crops", () => {
    expect(cropTreated(undefined, plantings, nameOf)).toBe('Winter wheat; Alfalfa');
    expect(cropTreated('gone', [], nameOf)).toBe('');
  });
});

describe('lockedNow', () => {
  it('reads locked once 48 h pass even before anything stamps it', () => {
    expect(lockedNow({ occurredAt: 0 }, 47 * HOUR)).toBe(false);
    expect(lockedNow({ occurredAt: 0 }, 48 * HOUR)).toBe(true);
    expect(lockedNow({ occurredAt: 0, lockedAt: 1 }, 1)).toBe(true);
  });
});
