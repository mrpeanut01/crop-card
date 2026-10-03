import { describe, expect, it } from 'vitest';
import { groupSplitRows, leftoverHasRuledOut, leftoverReasons } from './split';
import { splitLots } from '$lib/plan/splitGroup';
import type { LeftoverReport } from './types';

const row = (stockItemId: string, blockId: string) => ({
  stockItemId,
  blockId,
  cropPluginId: 'c',
  varietyDisplayName: stockItemId,
  plants: 1
});

describe('groupSplitRows (R-21)', () => {
  it('keeps server order when nothing is split', () => {
    const a = [row('x', 'b1'), row('y', 'b2')];
    expect(groupSplitRows(a, splitLots(a)).map((r) => r.index)).toEqual([0, 1]);
  });

  it('puts every part of a split lot at its first row', () => {
    const a = [row('x', 'b1'), row('y', 'b1'), row('x', 'b2'), row('z', 'b3')];
    expect(groupSplitRows(a, splitLots(a)).map((r) => r.index)).toEqual([0, 2, 1, 3]);
  });
});

describe('leftoverReasons (R-11)', () => {
  const report: LeftoverReport = {
    stockItemId: 's',
    cropPluginId: 'c',
    plantsLeft: 4,
    blocks: [
      { blockId: 'b1', status: 'full' },
      { blockId: 'b2', status: 'keep-apart', withPluginId: 'potato' },
      { blockId: 'b3', status: 'cross-pollination' },
      { blockId: 'b4', status: 'kept-in-one-bed' }
    ]
  };
  const names = {
    block: (id: string) => `Bed ${id.slice(1)}`,
    crop: (id: string) => (id === 'potato' ? 'Potato' : undefined)
  };

  it('writes one sentence per block from the codes', () => {
    expect(leftoverReasons(report, names)).toEqual([
      'Bed 1 is full',
      'Bed 2 has Potato, which should be kept apart from it',
      'Bed 3 has another crop, which would cross with it',
      'Bed 4 was not used: kept in one bed'
    ]);
  });

  it('writes Spanish from the same codes', () => {
    expect(leftoverReasons(report, names, 'es')[0]).toBe('No queda espacio en Bed 1');
  });

  it('words Spanish bed reasons so they read right for a feminine bed name', () => {
    const cama = { ...names, block: () => 'Cama 1' };
    const all = leftoverReasons(
      {
        ...report,
        blocks: (['full', 'too-small', 'narrow'] as const).map((status) => ({
          blockId: report.blocks[0].blockId,
          status
        }))
      },
      cama,
      'es'
    );
    for (const line of all) expect(line).not.toMatch(/llen[oa]|pequeñ|angost/);
    expect(all).toContain('En Cama 1 no cabe este cultivo');
  });

  it('knows when a block was ruled out rather than full', () => {
    expect(leftoverHasRuledOut(report)).toBe(true);
    expect(leftoverHasRuledOut({ ...report, blocks: [{ blockId: 'b', status: 'full' }] })).toBe(
      false
    );
    expect(leftoverHasRuledOut(undefined)).toBe(false);
  });
});
