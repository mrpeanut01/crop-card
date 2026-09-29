import { describe, expect, it } from 'vitest';
import { areaFromDimensions, blockSizePatch } from './editBlockSize';

const bed = { acres: 32 / 43560, widthFt: 4, lengthFt: 8 };

describe('Edit block size (#475)', () => {
  it('works the area out from width and length, so a typed area cannot disagree', () => {
    expect(areaFromDimensions({ showDimensions: true, widthFt: 4, lengthFt: 8 })).toBeCloseTo(
      32 / 43560,
      8
    );
    expect(
      blockSizePatch({ showDimensions: true, before: bed, acres: 0.01, widthFt: 4, lengthFt: 8 })
    ).toEqual({});
  });

  it('sends new dimensions when they change', () => {
    expect(
      blockSizePatch({ showDimensions: true, before: bed, acres: 0.01, widthFt: 4, lengthFt: 10 })
    ).toEqual({ widthFt: 4, lengthFt: 10 });
  });

  it('clears the dimensions when the owner removes them and types an area', () => {
    expect(
      blockSizePatch({
        showDimensions: true,
        before: bed,
        acres: 0.01,
        widthFt: null,
        lengthFt: null
      })
    ).toEqual({ acres: 0.01, widthFt: null, lengthFt: null });
  });

  it('keeps plain area editing for blocks without dimensions', () => {
    expect(
      blockSizePatch({
        showDimensions: true,
        before: { acres: 0.5 },
        acres: 0.25,
        widthFt: null,
        lengthFt: null
      })
    ).toEqual({ acres: 0.25 });
    expect(
      blockSizePatch({ showDimensions: false, before: bed, acres: 0.01, widthFt: 4, lengthFt: 8 })
    ).toEqual({ acres: 0.01 });
  });
});
