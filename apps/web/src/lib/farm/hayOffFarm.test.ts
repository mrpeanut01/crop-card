import { describe, expect, it } from 'vitest';
import { hayOffFarmNotices, hayOffFarmText } from './hayOffFarm';

const TZ = 'America/New_York';
const at = (m: number, d: number) => Date.UTC(2026, m - 1, d, 16);
const flagged = {
  blockId: 'b1',
  productName: 'GrazonNext HL',
  productPluginId: 'grazonnext-hl',
  restrictions: { hayOffFarmRestricted: true, source: 'GrazonNext HL, EPA Reg. No. 62719-628' }
};

describe('hayOffFarmNotices (M-51)', () => {
  it('notes a cutting from a block sprayed on or before the cut', () => {
    const out = hayOffFarmNotices(
      [{ id: 'c1', blockId: 'b1', cutAtMs: at(6, 1) }],
      [{ ...flagged, appliedAtMs: at(5, 1) }],
      TZ
    );
    expect(out.c1).toEqual([
      {
        productName: 'GrazonNext HL',
        text: 'The GrazonNext HL label limits moving or selling hay from treated ground off the farm. Read the label before you sell or move this hay.',
        appliedOn: 'May 1, 2026',
        source: 'GrazonNext HL, EPA Reg. No. 62719-628'
      }
    ]);
    expect(hayOffFarmText('X')).not.toMatch(/\d/);
  });

  it('ignores sprays after the cut, other blocks and products without the flag', () => {
    const out = hayOffFarmNotices(
      [{ id: 'c1', blockId: 'b1', cutAtMs: at(6, 1) }],
      [
        { ...flagged, appliedAtMs: at(6, 2) },
        { ...flagged, blockId: 'b2', appliedAtMs: at(5, 1) },
        {
          ...flagged,
          productPluginId: 'crossbow',
          productName: 'Crossbow',
          restrictions: { source: 'x' },
          appliedAtMs: at(5, 1)
        }
      ],
      TZ
    );
    expect(out).toEqual({});
  });

  it('lists each product once, at its latest spray', () => {
    const out = hayOffFarmNotices(
      [{ id: 'c1', blockId: 'b1', cutAtMs: at(9, 1) }],
      [
        { ...flagged, appliedAtMs: at(5, 1) },
        { ...flagged, appliedAtMs: at(7, 1) }
      ],
      TZ
    );
    expect(out.c1).toHaveLength(1);
    expect(out.c1[0].appliedOn).toBe('Jul 1, 2026');
  });
});
