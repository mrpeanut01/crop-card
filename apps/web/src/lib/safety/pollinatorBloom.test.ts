import { describe, it, expect } from 'vitest';
import { checkPollinatorBloom, isInBloom } from './pollinatorBloom';

const MAY_24 = Date.UTC(2026, 4, 24);

describe('isInBloom', () => {
  it('returns false when crop has no bloomWindow', () => {
    expect(isInBloom({ cropPluginId: 'kale', plantedAt: MAY_24 - 30 * 86_400_000 }, MAY_24)).toBe(
      false
    );
  });

  it('returns false when bloomWindow.beeAttractive is explicitly false', () => {
    expect(
      isInBloom(
        {
          cropPluginId: 'tomato',
          plantedAt: MAY_24 - 60 * 86_400_000,
          bloomWindow: { continuous: true, beeAttractive: false }
        },
        MAY_24
      )
    ).toBe(false);
  });

  it('continuous bloom: in-bloom after default first-flower (30d post-plant)', () => {
    expect(
      isInBloom(
        {
          cropPluginId: 'tomato',
          plantedAt: MAY_24 - 45 * 86_400_000,
          bloomWindow: { continuous: true, beeAttractive: true }
        },
        MAY_24
      )
    ).toBe(true);
  });

  it('continuous bloom: NOT in-bloom before first flower', () => {
    expect(
      isInBloom(
        {
          cropPluginId: 'cucurbit',
          plantedAt: MAY_24 - 10 * 86_400_000,
          bloomWindow: { continuous: true, daysFromPlantingMin: 35, beeAttractive: true }
        },
        MAY_24
      )
    ).toBe(false);
  });

  it('monthsOfYear: in-bloom when current UTC month matches', () => {
    expect(
      isInBloom(
        {
          cropPluginId: 'apple',
          plantedAt: MAY_24 - 365 * 86_400_000,
          bloomWindow: { monthsOfYear: [4, 5], beeAttractive: true }
        },
        MAY_24
      )
    ).toBe(true);
  });

  it('monthsOfYear: NOT in-bloom outside declared months', () => {
    expect(
      isInBloom(
        {
          cropPluginId: 'peach',
          plantedAt: MAY_24 - 365 * 86_400_000,
          bloomWindow: { monthsOfYear: [3, 4], beeAttractive: true }
        },
        MAY_24
      )
    ).toBe(false);
  });

  it('daysFromPlanting window: in-bloom inside [min,max]', () => {
    expect(
      isInBloom(
        {
          cropPluginId: 'cucumber',
          plantedAt: MAY_24 - 40 * 86_400_000,
          bloomWindow: { daysFromPlantingMin: 35, daysFromPlantingMax: 50, beeAttractive: true }
        },
        MAY_24
      )
    ).toBe(true);
  });

  it('daysFromPlanting window: NOT in-bloom past max', () => {
    expect(
      isInBloom(
        {
          cropPluginId: 'cucumber',
          plantedAt: MAY_24 - 100 * 86_400_000,
          bloomWindow: { daysFromPlantingMin: 35, daysFromPlantingMax: 50, beeAttractive: true }
        },
        MAY_24
      )
    ).toBe(false);
  });
});

describe('checkPollinatorBloom', () => {
  it('returns no violations when no proposed product is bee-toxic', () => {
    const v = checkPollinatorBloom(
      [{ pluginId: 'bt-aizawai', pollinatorRisk: 'none' }],
      [
        {
          cropPluginId: 'apple',
          plantedAt: MAY_24 - 365 * 86_400_000,
          bloomWindow: { monthsOfYear: [5], beeAttractive: true }
        }
      ],
      MAY_24
    );
    expect(v).toEqual([]);
  });

  it('returns no violations when no crop in the block is in bloom', () => {
    const v = checkPollinatorBloom(
      [{ pluginId: 'spinosad', pollinatorRisk: 'high' }],
      [{ cropPluginId: 'kale', plantedAt: MAY_24 - 30 * 86_400_000 }],
      MAY_24
    );
    expect(v).toEqual([]);
  });

  it('blocks when bee-toxic spray AND a crop is in bloom AND beeAttractive', () => {
    const v = checkPollinatorBloom(
      [{ pluginId: 'spinosad', pollinatorRisk: 'high' }],
      [
        {
          cropPluginId: 'apple',
          plantedAt: MAY_24 - 365 * 86_400_000,
          bloomWindow: { monthsOfYear: [5], beeAttractive: true }
        }
      ],
      MAY_24
    );
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe('POLLINATOR_BLOOM_BLOCK');
  });

  it('treats unknown pollinatorRisk as risky (conservative default)', () => {
    const v = checkPollinatorBloom(
      [{ pluginId: 'mystery-product' }],
      [
        {
          cropPluginId: 'cucumber',
          plantedAt: MAY_24 - 40 * 86_400_000,
          bloomWindow: { daysFromPlantingMin: 35, beeAttractive: true }
        }
      ],
      MAY_24
    );
    expect(v).toHaveLength(1);
  });

  it('skips bee-attractiveness=false even with moderate risk + in-bloom', () => {
    const v = checkPollinatorBloom(
      [{ pluginId: 'spinosad', pollinatorRisk: 'moderate' }],
      [
        {
          cropPluginId: 'self-pollinated-tomato',
          plantedAt: MAY_24 - 60 * 86_400_000,
          bloomWindow: { continuous: true, beeAttractive: false }
        }
      ],
      MAY_24
    );
    expect(v).toEqual([]);
  });

  it('lists all blooming crops + all risky products in the violation detail', () => {
    const v = checkPollinatorBloom(
      [
        { pluginId: 'a', pollinatorRisk: 'high' },
        { pluginId: 'b', pollinatorRisk: 'moderate' }
      ],
      [
        {
          cropPluginId: 'apple',
          plantedAt: MAY_24 - 365 * 86_400_000,
          bloomWindow: { monthsOfYear: [5], beeAttractive: true }
        },
        {
          cropPluginId: 'cucumber',
          plantedAt: MAY_24 - 50 * 86_400_000,
          bloomWindow: { continuous: true, beeAttractive: true }
        }
      ],
      MAY_24
    );
    expect(v).toHaveLength(1);
    expect(v[0].detail?.bloomingCrops).toEqual(['apple', 'cucumber']);
    expect(v[0].detail?.riskyProducts).toEqual(['a', 'b']);
  });
});
