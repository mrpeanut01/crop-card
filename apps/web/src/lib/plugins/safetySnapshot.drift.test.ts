import { describe, expect, it } from 'vitest';
import * as snapshot from '@cropcard/plugin-validation/safety-snapshot';
import { CHEMISTRY_KILL_MATRIX, CROP_FAMILIES } from '$lib/safety/cropFamilyLethality';
import { CHEMISTRY_CLASSES } from '$lib/safety/types';

describe('plugin-validation safety snapshot', () => {
  it('matches the kernel (run pnpm gen:safety-snapshot when this fails)', () => {
    expect([...snapshot.CHEMISTRY_CLASSES]).toEqual([...CHEMISTRY_CLASSES]);
    expect([...snapshot.CROP_FAMILIES]).toEqual([...CROP_FAMILIES]);
    expect(JSON.parse(JSON.stringify(snapshot.CHEMISTRY_KILL_MATRIX))).toEqual(
      JSON.parse(JSON.stringify(CHEMISTRY_KILL_MATRIX))
    );
  });
});
