import { describe, it, expect } from 'vitest';
import { checkIpmThreshold } from './ipmThreshold';

const NOW = Date.UTC(2026, 4, 24); // May 24, 2026

describe('checkIpmThreshold', () => {
  it('exempts plugins with no scoutingThresholds (no threshold declared = no gate)', () => {
    const v = checkIpmThreshold([{ pluginId: 'spinosad', scoutingThresholds: [] }], []);
    expect(v).toEqual([]);
  });

  it('blocks when no qualifying scout observation exists', () => {
    const v = checkIpmThreshold(
      [
        {
          pluginId: 'bt-aizawai',
          scoutingThresholds: [
            { pest: 'european-corn-borer', metric: 'count-per-plant', threshold: 1 }
          ]
        }
      ],
      []
    );
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe('IPM_THRESHOLD_NOT_MET');
  });

  it('blocks when latest scout observation is below threshold', () => {
    const v = checkIpmThreshold(
      [
        {
          pluginId: 'bt-aizawai',
          scoutingThresholds: [
            { pest: 'european-corn-borer', metric: 'count-per-plant', threshold: 2 }
          ]
        }
      ],
      [
        {
          pest: 'european-corn-borer',
          metric: 'count-per-plant',
          value: 1,
          occurredAt: NOW - 2 * 86_400_000
        }
      ]
    );
    expect(v).toHaveLength(1);
  });

  it('allows the spray when latest scout observation meets the threshold', () => {
    const v = checkIpmThreshold(
      [
        {
          pluginId: 'bt-aizawai',
          scoutingThresholds: [
            { pest: 'european-corn-borer', metric: 'count-per-plant', threshold: 1 }
          ]
        }
      ],
      [
        {
          pest: 'european-corn-borer',
          metric: 'count-per-plant',
          value: 3,
          occurredAt: NOW - 2 * 86_400_000
        }
      ]
    );
    expect(v).toEqual([]);
  });

  it('uses the MOST RECENT observation when multiple exist for the same (pest, metric)', () => {
    // Stale high reading; recent low reading = block.
    const v = checkIpmThreshold(
      [
        {
          pluginId: 'spinosad',
          scoutingThresholds: [{ pest: 'thrips', metric: 'count-per-plant', threshold: 5 }]
        }
      ],
      [
        {
          pest: 'thrips',
          metric: 'count-per-plant',
          value: 8,
          occurredAt: NOW - 30 * 86_400_000
        },
        {
          pest: 'thrips',
          metric: 'count-per-plant',
          value: 1,
          occurredAt: NOW - 2 * 86_400_000
        }
      ]
    );
    expect(v).toHaveLength(1);
  });

  it('allows when ANY ONE of the plugin thresholds is met (multi-pest coverage)', () => {
    // Threshold for ECB not met (1 < 2), but threshold for armyworm met (5 ≥ 4).
    const v = checkIpmThreshold(
      [
        {
          pluginId: 'bt-aizawai',
          scoutingThresholds: [
            { pest: 'european-corn-borer', metric: 'count-per-plant', threshold: 2 },
            { pest: 'armyworm', metric: 'count-per-plant', threshold: 4 }
          ]
        }
      ],
      [
        {
          pest: 'european-corn-borer',
          metric: 'count-per-plant',
          value: 1,
          occurredAt: NOW
        },
        { pest: 'armyworm', metric: 'count-per-plant', value: 5, occurredAt: NOW }
      ]
    );
    expect(v).toEqual([]);
  });

  it('ignores observations of different metrics on the same pest', () => {
    const v = checkIpmThreshold(
      [
        {
          pluginId: 'bt-aizawai',
          scoutingThresholds: [
            { pest: 'european-corn-borer', metric: 'count-per-plant', threshold: 2 }
          ]
        }
      ],
      [
        // Observed defoliation, not count — doesn't qualify.
        {
          pest: 'european-corn-borer',
          metric: 'pct-defoliation',
          value: 50,
          occurredAt: NOW
        }
      ]
    );
    expect(v).toHaveLength(1);
  });
});
