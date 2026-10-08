import { describe, expect, it } from 'vitest';
import {
  compactDetails,
  harvestDetailLines,
  parseDecimal,
  parseStoredDetails,
  serializeDetails
} from './details';
import { createT } from '$lib/i18n';

describe('harvest details (#662)', () => {
  it('reads typed decimals, including a comma keyboard', () => {
    expect(parseDecimal('13,9')).toBe(13.9);
    expect(parseDecimal(' 92 ')).toBe(92);
    expect(parseDecimal('')).toBeUndefined();
    expect(parseDecimal('abc')).toBeUndefined();
  });

  it('stores only what was measured', () => {
    expect(
      compactDetails({ pickNumber: 2, marketablePct: undefined, boltObserved: false })
    ).toEqual({ pickNumber: 2 });
    expect(serializeDetails({ boltObserved: false })).toBeNull();
    expect(parseStoredDetails(serializeDetails({ brix: 17.5, ph: 3.3 }))).toEqual({
      brix: 17.5,
      ph: 3.3
    });
  });

  it('reads a bad stored value as none', () => {
    expect(parseStoredDetails('not json')).toBeUndefined();
    expect(parseStoredDetails('{"ph":99}')).toBeUndefined();
    expect(parseStoredDetails(null)).toBeUndefined();
  });

  it('describes the readings in English and Spanish', () => {
    const d = {
      pickNumber: 3,
      marketablePct: 92,
      cutHeightIn: 2,
      terminationMethod: 'mow' as const
    };
    expect(harvestDetailLines(d)).toEqual([
      'Pick 3',
      'Marketable 92%',
      'Cut height 2 in',
      'Ended by Mow only'
    ]);
    const es = harvestDetailLines(d, createT('es'));
    expect(es[0]).toBe('Recolección 3');
    expect(es).toHaveLength(4);
  });
});
