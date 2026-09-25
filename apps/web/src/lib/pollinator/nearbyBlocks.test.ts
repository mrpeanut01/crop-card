import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { BeeToxicity } from '$lib/safety/pollinatorProtection';
import {
  NEARBY_POLLINATOR_RADIUS_FT,
  checkNearbyPollinatorBlocks,
  formatDistance,
  type NeighborBlock,
  type NeighborCrop
} from './nearbyBlocks';

const squash = (inBloomNow = true): NeighborCrop => ({
  cropPluginId: 'squash',
  displayName: 'Squash',
  inBloomNow,
  beeAttractive: true
});
const wheat: NeighborCrop = {
  cropPluginId: 'wheat',
  displayName: 'Wheat',
  inBloomNow: false,
  beeAttractive: false
};
const block = (
  blockId: string,
  distanceFt: number | null,
  crops: NeighborCrop[] = [squash()]
): NeighborBlock => ({ blockId, name: blockId.toUpperCase(), distanceFt, crops });

describe('checkNearbyPollinatorBlocks', () => {
  it('defaults to a one-mile radius', () => {
    expect(NEARBY_POLLINATOR_RADIUS_FT).toBe(5280);
    const r = checkNearbyPollinatorBlocks({
      beeToxicity: 'highly-toxic',
      neighbors: [block('a', 5280), block('b', 5281)]
    });
    expect(r.radiusFt).toBe(5280);
    expect(r.blocks.map((b) => b.blockId)).toEqual(['a']);
  });

  it('warns for toxic and highly-toxic products with an attractive block in range', () => {
    for (const tox of ['toxic', 'highly-toxic'] as const) {
      const r = checkNearbyPollinatorBlocks({ beeToxicity: tox, neighbors: [block('a', 900)] });
      expect(r.status).toBe('warn');
      expect(r.id).toBe('nearby-blocks');
    }
  });

  it('passes for relatively-nontoxic and undeclared toxicity', () => {
    for (const tox of ['relatively-nontoxic', 'unknown'] as const) {
      const r = checkNearbyPollinatorBlocks({ beeToxicity: tox, neighbors: [block('a', 900)] });
      expect(r.status).toBe('pass');
      expect(r.blocks).toHaveLength(1);
    }
  });

  it('ignores blocks with only non-attractive, non-blooming crops', () => {
    const r = checkNearbyPollinatorBlocks({
      beeToxicity: 'highly-toxic',
      neighbors: [block('grain', 100, [wheat])]
    });
    expect(r.status).toBe('pass');
    expect(r.blocks).toHaveLength(0);
  });

  it('labels in-bloom ahead of bee-attractive and lists crop names once', () => {
    const r = checkNearbyPollinatorBlocks({
      beeToxicity: 'toxic',
      neighbors: [
        block('bloom', 300, [squash(true), squash(false), wheat]),
        block('attractive', 200, [squash(false)])
      ]
    });
    expect(r.blocks.map((b) => [b.blockId, b.reason])).toEqual([
      ['attractive', 'bee-attractive'],
      ['bloom', 'in-bloom']
    ]);
    expect(r.blocks[1].crops).toEqual(['Squash']);
  });

  it('reports unknown distance neutrally — listed but never the cause of a warning', () => {
    const r = checkNearbyPollinatorBlocks({
      beeToxicity: 'highly-toxic',
      neighbors: [block('unmapped', null), block('nan', Number.NaN)]
    });
    expect(r.status).toBe('pass');
    expect(r.blocks).toHaveLength(0);
    expect(r.unknownDistance.map((b) => b.blockId)).toEqual(['unmapped', 'nan']);
    expect(r.unknownDistance.every((b) => b.distanceFt === null)).toBe(true);
    expect(r.reason).toMatch(/distance is unknown/);
  });

  it('formats distances in feet under 1000 ft and miles above', () => {
    expect(formatDistance(420.4)).toBe('420 ft');
    expect(formatDistance(2640)).toBe('0.5 mi');
    expect(formatDistance(null)).toBe('distance unknown');
    expect(formatDistance(420.4, { units: 'metric' })).toBe('128 m');
    expect(formatDistance(5280, { units: 'metric' })).toBe('1.6 km');
    expect(formatDistance(null, { units: 'metric' })).toBe('distance unknown');
    const metric = checkNearbyPollinatorBlocks({
      beeToxicity: 'toxic',
      neighbors: [],
      prefs: { units: 'metric' }
    });
    expect(metric.reason).toContain('within 1.6 km');
  });
});

const toxArb = fc.constantFrom<BeeToxicity>(
  'highly-toxic',
  'toxic',
  'relatively-nontoxic',
  'unknown'
);
const cropArb = fc.record({
  cropPluginId: fc.constantFrom('squash', 'apple', 'wheat', 'clover'),
  inBloomNow: fc.boolean(),
  beeAttractive: fc.boolean()
});
const neighborsArb = fc.array(
  fc.record({
    blockId: fc.uuid(),
    name: fc.string(),
    distanceFt: fc.option(fc.double({ min: 0, max: 50_000, noNaN: true }), { nil: null }),
    crops: fc.array(cropArb, { maxLength: 4 })
  }),
  { maxLength: 8 }
);
const RANK = { pass: 0, warn: 1 } as const;

describe('checkNearbyPollinatorBlocks — properties', () => {
  it('nearby-blocks never blocks', () => {
    fc.assert(
      fc.property(
        toxArb,
        neighborsArb,
        fc.double({ min: 0, max: 50_000, noNaN: true }),
        (t, n, r) => {
          const out = checkNearbyPollinatorBlocks({ beeToxicity: t, neighbors: n, radiusFt: r });
          expect(['pass', 'warn']).toContain(out.status);
        }
      )
    );
  });

  it('is monotonic in distance: moving every block further away never raises the verdict', () => {
    fc.assert(
      fc.property(
        toxArb,
        neighborsArb,
        fc.double({ min: 0, max: 20_000, noNaN: true }),
        (t, n, d) => {
          const near = checkNearbyPollinatorBlocks({ beeToxicity: t, neighbors: n });
          const farther = checkNearbyPollinatorBlocks({
            beeToxicity: t,
            neighbors: n.map((b) => ({
              ...b,
              distanceFt: b.distanceFt === null ? null : b.distanceFt + d
            }))
          });
          expect(RANK[farther.status]).toBeLessThanOrEqual(RANK[near.status]);
          expect(farther.blocks.length).toBeLessThanOrEqual(near.blocks.length);
        }
      )
    );
  });

  it('is monotonic in radius: a wider radius never lowers the verdict', () => {
    fc.assert(
      fc.property(
        toxArb,
        neighborsArb,
        fc.double({ min: 0, max: 20_000, noNaN: true }),
        fc.double({ min: 0, max: 20_000, noNaN: true }),
        (t, n, r, extra) => {
          const a = checkNearbyPollinatorBlocks({ beeToxicity: t, neighbors: n, radiusFt: r });
          const b = checkNearbyPollinatorBlocks({
            beeToxicity: t,
            neighbors: n,
            radiusFt: r + extra
          });
          expect(RANK[b.status]).toBeGreaterThanOrEqual(RANK[a.status]);
        }
      )
    );
  });

  it('only warns for toxic or highly-toxic products', () => {
    fc.assert(
      fc.property(toxArb, neighborsArb, (t, n) => {
        const out = checkNearbyPollinatorBlocks({ beeToxicity: t, neighbors: n });
        if (out.status === 'warn') expect(['toxic', 'highly-toxic']).toContain(t);
      })
    );
  });

  it('listed blocks are within the radius and sorted nearest first', () => {
    fc.assert(
      fc.property(toxArb, neighborsArb, (t, n) => {
        const out = checkNearbyPollinatorBlocks({ beeToxicity: t, neighbors: n });
        const d = out.blocks.map((b) => b.distanceFt as number);
        expect(d.every((x) => x <= out.radiusFt)).toBe(true);
        expect([...d].sort((x, y) => x - y)).toEqual(d);
      })
    );
  });
});
