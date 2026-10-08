import { describe, expect, it } from 'vitest';
import { distinctRecommendations, recommendationCropLines } from './recommendations';

const MAR30 = Date.parse('2027-03-30T06:51:25Z');

function ev(over: Record<string, unknown> = {}) {
  return {
    kind: 'stage-window' as const,
    blockId: 'b1',
    cropId: 'p1',
    cropPluginId: 'lettuce-red-sails',
    varietyDisplayName: 'Lettuce Red Sails (AAS Winner)',
    title: 'Cotyledon',
    startMs: MAR30,
    ...over
  };
}

describe('Recommended rows (#712)', () => {
  it('shows the same stage of the same planting once', () => {
    const rows = distinctRecommendations([ev(), ev({ startMs: MAR30 + 3_600_000 }), ev()]);
    expect(rows).toHaveLength(1);
  });

  it('keeps two plantings apart and names their beds', () => {
    const rows = distinctRecommendations([ev(), ev({ cropId: 'p2', blockId: 'b2' })]);
    expect(rows).toHaveLength(2);
    const names: Record<string, string> = { b1: 'Bed 1', b2: 'Bed 2' };
    expect(
      recommendationCropLines(
        rows,
        (e) => e.varietyDisplayName,
        (id) => names[id]
      )
    ).toEqual(['Lettuce Red Sails (AAS Winner) · Bed 1', 'Lettuce Red Sails (AAS Winner) · Bed 2']);
  });

  it('leaves the bed off when the rows already read differently', () => {
    const rows = [ev(), ev({ cropId: 'p2', title: 'True leaves' })];
    expect(
      recommendationCropLines(
        rows,
        (e) => e.varietyDisplayName,
        () => 'Bed 1'
      )
    ).toEqual(['Lettuce Red Sails (AAS Winner)', 'Lettuce Red Sails (AAS Winner)']);
  });

  it('stops at the limit after removing repeats', () => {
    const many = Array.from({ length: 12 }, (_, i) => ev({ cropId: `p${i % 6}` }));
    expect(distinctRecommendations(many, 8)).toHaveLength(6);
    expect(distinctRecommendations(many, 3)).toHaveLength(3);
  });
});
