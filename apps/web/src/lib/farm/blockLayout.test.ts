import { describe, expect, it } from 'vitest';
import { blockLayoutPatchSchema, blockLayoutSchema } from './blockLayout';
import { parseKindFilter } from './kindFilter';
import { AREA_KINDS, BLOCK_KINDS } from './areaKinds';

describe('blockLayoutSchema', () => {
  it('accepts a bed with a position, a quarter-turn and a style', () => {
    const r = blockLayoutSchema.parse({
      kind: 'bed',
      xFt: 2.5,
      yFt: 0,
      rotationDeg: 450,
      bedStyle: 'raised'
    });
    expect(r).toEqual({ kind: 'bed', xFt: 2.5, yFt: 0, rotationDeg: 90, bedStyle: 'raised' });
  });

  it('is all-optional so legacy block payloads still validate', () => {
    expect(blockLayoutSchema.parse({})).toEqual({});
  });

  it('rejects off-grid rotations, negative positions and unknown kinds', () => {
    expect(blockLayoutSchema.safeParse({ rotationDeg: 45 }).success).toBe(false);
    expect(blockLayoutSchema.safeParse({ xFt: -1 }).success).toBe(false);
    expect(blockLayoutSchema.safeParse({ kind: 'plot' }).success).toBe(false);
    expect(blockLayoutSchema.safeParse({ bedStyle: 'hugelkultur' }).success).toBe(false);
    expect(blockLayoutSchema.safeParse({ xFt: null }).success).toBe(false);
  });

  it('lets PATCH clear layout fields with null', () => {
    expect(
      blockLayoutPatchSchema.parse({ xFt: null, yFt: null, rotationDeg: null, bedStyle: null })
    ).toEqual({ xFt: null, yFt: null, rotationDeg: null, bedStyle: null });
    expect(blockLayoutPatchSchema.parse({ rotationDeg: -90 })).toEqual({ rotationDeg: 270 });
  });
});

describe('parseKindFilter', () => {
  it('is null when absent or empty', () => {
    expect(parseKindFilter(null, AREA_KINDS)).toBeNull();
    expect(parseKindFilter('', AREA_KINDS)).toBeNull();
    expect(parseKindFilter(' , ', AREA_KINDS)).toBeNull();
  });

  it('splits, trims and de-duplicates known kinds', () => {
    expect(parseKindFilter('garden, greenhouse,garden', AREA_KINDS)).toEqual([
      'garden',
      'greenhouse'
    ]);
    expect(parseKindFilter('bed', BLOCK_KINDS)).toEqual(['bed']);
  });

  it('rejects the whole filter on any unknown kind', () => {
    expect(parseKindFilter('garden,location', AREA_KINDS)).toBe('invalid');
    expect(parseKindFilter('garden', BLOCK_KINDS)).toBe('invalid');
  });
});
