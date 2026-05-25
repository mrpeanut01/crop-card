import { describe, it, expect } from 'vitest';
import { checkFracRotation } from './fracRotation';

const NOW = Date.UTC(2026, 4, 24); // May 24, 2026

describe('checkFracRotation', () => {
  it('returns no violations when block has no prior fungicide history', () => {
    const v = checkFracRotation([{ pluginId: 'manzate', fracCodes: ['M03'] }], []);
    expect(v).toEqual([]);
  });

  it('returns no violations when proposed FRAC codes do not overlap most-recent prior', () => {
    const v = checkFracRotation(
      [{ pluginId: 'serenade', fracCodes: ['BM01'] }],
      [
        {
          pluginId: 'manzate',
          fracCodes: ['M03'],
          occurredAt: NOW - 7 * 86_400_000
        }
      ]
    );
    expect(v).toEqual([]);
  });

  it('blocks when proposed shares a FRAC code with the most-recent prior', () => {
    const v = checkFracRotation(
      [{ pluginId: 'penncozeb', fracCodes: ['M03'] }],
      [
        {
          pluginId: 'manzate',
          fracCodes: ['M03'],
          occurredAt: NOW - 7 * 86_400_000
        }
      ]
    );
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe('FRAC_ROTATION_BLOCK');
    expect(v[0].detail?.sharedFracCodes).toEqual(['M03']);
    expect(v[0].detail?.priorProduct).toBe('manzate');
  });

  it('only compares against the MOST RECENT prior, not all priors', () => {
    // Older same-FRAC prior; recent prior is different FRAC → rotated OK.
    const v = checkFracRotation(
      [{ pluginId: 'penncozeb', fracCodes: ['M03'] }],
      [
        {
          pluginId: 'manzate',
          fracCodes: ['M03'],
          occurredAt: NOW - 14 * 86_400_000
        },
        {
          pluginId: 'serenade',
          fracCodes: ['BM01'],
          occurredAt: NOW - 5 * 86_400_000
        }
      ]
    );
    expect(v).toEqual([]);
  });

  it('blocks when multi-FRAC tank shares any code with prior', () => {
    const v = checkFracRotation(
      [{ pluginId: 'switch', fracCodes: ['9', '12'] }],
      [
        {
          pluginId: 'scala',
          fracCodes: ['9'],
          occurredAt: NOW - 7 * 86_400_000
        }
      ]
    );
    expect(v[0].detail?.sharedFracCodes).toEqual(['9']);
  });

  it('emits one violation per overlapping proposed product', () => {
    const v = checkFracRotation(
      [
        { pluginId: 'a-m03', fracCodes: ['M03'] },
        { pluginId: 'b-m03', fracCodes: ['M03'] },
        { pluginId: 'c-clean', fracCodes: ['11'] }
      ],
      [
        {
          pluginId: 'prior-m03',
          fracCodes: ['M03'],
          occurredAt: NOW - 7 * 86_400_000
        }
      ]
    );
    expect(v).toHaveLength(2);
    expect(v.map((x) => x.detail?.product)).toEqual(['a-m03', 'b-m03']);
  });
});
