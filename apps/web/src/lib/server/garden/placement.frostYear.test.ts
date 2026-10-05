// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const years = vi.hoisted(() => [] as number[]);

vi.mock('$lib/server/blockFrost.server', () => ({
  bedFrostMs: (_blockId: string, year: number) => {
    years.push(year);
    return {
      lastSpringFrostMs: Date.UTC(year, 3, 15),
      firstFallFrostMs: Date.UTC(year, 9, 20),
      frostFree: false
    };
  }
}));

vi.mock('$lib/db/crops', async (orig) => ({
  ...(await orig<typeof import('$lib/db/crops')>()),
  listCrops: () => []
}));

import type { Crop } from '$lib/db/crops';
import { linkedSowingClash, sharedSpaceWarnings } from './placement';

const NEW_YEAR_UTC = Date.UTC(2027, 0, 1, 2);
const FOOTPRINT = { x_in: 0, y_in: 0, w_in: 12, l_in: 12 };
const savedTz = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'America/New_York';
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});
beforeEach(() => {
  years.length = 0;
});

describe('garden placement frost year', () => {
  it('reads the season year in UTC like the designer, not the server local year', () => {
    expect(new Date(NEW_YEAR_UTC).getFullYear()).toBe(2026);
    const crop = {
      id: 'c1',
      blockId: 'b1',
      cropPluginId: 'lettuce',
      plantingDate: NEW_YEAR_UTC,
      footprint: FOOTPRINT
    } as unknown as Crop;
    sharedSpaceWarnings(crop, () => undefined);
    linkedSowingClash(
      crop,
      { blockId: 'b1', footprint: FOOTPRINT, plantingDateMs: NEW_YEAR_UTC },
      'Bed 1',
      () => undefined
    );
    expect(years).toEqual([2027, 2027]);
  });
});
