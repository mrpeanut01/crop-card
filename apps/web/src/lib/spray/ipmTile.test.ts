import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ipmTile } from './ipmTile';
import { checkIpmThreshold } from '$lib/safety/ipmThreshold';

const NOW = Date.UTC(2027, 3, 19, 12);
const DAY = 86_400_000;
const weevil = { pest: 'alfalfa weevil', metric: 'count-per-plant', threshold: 1 };
const stinkBug = { pest: 'stink bug', metric: 'count-per-plant', threshold: 3 };

describe('ipmTile (#740)', () => {
  it('shows the threshold the typed observation meets, not the first declared', () => {
    const tile = ipmTile(
      [weevil, stinkBug],
      [{ pest: 'stink bug', metric: 'count-per-plant', value: 3, occurredAt: NOW }],
      NOW
    );
    expect(tile?.threshold).toBe(stinkBug);
    expect(tile?.met).toBe(true);
    expect(tile?.latest?.value).toBe(3);
    expect(tile?.weeks.at(-1)).toEqual({ weeksAgo: 0, value: 3, triggered: true });
  });

  it('falls back to the most recently counted threshold, then the first', () => {
    expect(ipmTile([weevil, stinkBug], [], NOW)?.threshold).toBe(weevil);
    const tile = ipmTile(
      [weevil, stinkBug],
      [
        { pest: 'alfalfa weevil', metric: 'count-per-plant', value: 0, occurredAt: NOW - 9 * DAY },
        { pest: 'stink bug', metric: 'count-per-plant', value: 1, occurredAt: NOW - 2 * DAY }
      ],
      NOW
    );
    expect(tile?.threshold).toBe(stinkBug);
    expect(tile?.met).toBe(false);
  });

  it('buckets weeks back from the given now, not the real clock', () => {
    const tile = ipmTile(
      [weevil],
      [{ pest: 'alfalfa weevil', metric: 'count-per-plant', value: 2, occurredAt: NOW - 8 * DAY }],
      NOW
    );
    expect(tile?.weeks.map((w) => w.value)).toEqual([null, null, null, 2, null]);
  });

  it('agrees with the gate on random observations', () => {
    const pests = ['a', 'b', 'c'];
    const metrics = ['count-per-plant', 'pct-defoliation'];
    const threshold = fc.record({
      pest: fc.constantFrom(...pests),
      metric: fc.constantFrom(...metrics),
      threshold: fc.integer({ min: 0, max: 10 })
    });
    const obs = fc.record({
      pest: fc.constantFrom(...pests),
      metric: fc.constantFrom(...metrics),
      value: fc.integer({ min: 0, max: 12 }),
      occurredAt: fc.integer({ min: NOW - 40 * DAY, max: NOW })
    });
    fc.assert(
      fc.property(fc.array(threshold, { minLength: 1, maxLength: 4 }), fc.array(obs), (ts, os) => {
        const tile = ipmTile(ts, os, NOW)!;
        const gateOpen =
          checkIpmThreshold([{ pluginId: 'p', scoutingThresholds: ts }], os).length === 0;
        expect(tile.met).toBe(gateOpen);
      })
    );
  });
});
