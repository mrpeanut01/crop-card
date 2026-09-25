import { describe, expect, it } from 'vitest';
import { isEmptySeason, priorSeasonSummary, type SeasonStartBlock } from './seasonStart';

const d = (y: number, m = 5, day = 1) => new Date(y, m - 1, day).getTime();

function block(id: string, plantings: SeasonStartBlock['plantings'], label?: string) {
  return { id, name: `Block ${id}`, blockLabel: label, plantings };
}

describe('isEmptySeason', () => {
  it('is empty with no blocks', () => {
    expect(isEmptySeason([], 2026)).toBe(true);
  });

  it('is empty when blocks have no plantings', () => {
    expect(isEmptySeason([block('a', [])], 2026)).toBe(true);
  });

  it('is empty when every planting belongs to a prior year', () => {
    const blocks = [
      block('a', [{ varietyDisplayName: 'Corn', plantingDate: d(2025) }]),
      block('b', [{ varietyDisplayName: 'Squash', plantingDate: d(2024, 12, 31) }])
    ];
    expect(isEmptySeason(blocks, 2026)).toBe(true);
  });

  it('is not empty once a planting is dated this year', () => {
    const blocks = [
      block('a', [
        { varietyDisplayName: 'Corn', plantingDate: d(2025) },
        { varietyDisplayName: 'Beans', plantingDate: d(2026, 1, 1) }
      ])
    ];
    expect(isEmptySeason(blocks, 2026)).toBe(false);
  });

  it('treats an undated planned planting as this season', () => {
    const blocks = [block('a', [{ varietyDisplayName: 'Garlic', plantingDate: null }])];
    expect(isEmptySeason(blocks, 2026)).toBe(false);
  });

  it('treats a future-year planting as already planned', () => {
    const blocks = [block('a', [{ varietyDisplayName: 'Wheat', plantingDate: d(2027, 3) }])];
    expect(isEmptySeason(blocks, 2026)).toBe(false);
  });
});

describe('priorSeasonSummary', () => {
  it('returns null when last year had no plantings', () => {
    const blocks = [block('a', [{ varietyDisplayName: 'Corn', plantingDate: d(2024) }])];
    expect(priorSeasonSummary(blocks, 2026)).toBeNull();
  });

  it('lists last year crops per block, deduped, preferring the block label', () => {
    const blocks = [
      block(
        'a',
        [
          { varietyDisplayName: 'Corn', plantingDate: d(2025, 5) },
          { varietyDisplayName: 'Corn', plantingDate: d(2025, 6) },
          { varietyDisplayName: 'Beans', plantingDate: d(2025, 6) },
          { varietyDisplayName: 'Old rye', plantingDate: d(2024, 10) },
          { varietyDisplayName: 'Planned', plantingDate: null }
        ],
        'North'
      ),
      block('b', [])
    ];
    expect(priorSeasonSummary(blocks, 2026)).toEqual({
      year: 2025,
      blocks: [{ blockId: 'a', blockName: 'North', crops: ['Corn', 'Beans'] }]
    });
  });
});
