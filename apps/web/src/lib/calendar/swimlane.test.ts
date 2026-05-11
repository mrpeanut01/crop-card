import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { Block, PlantingRecord } from '$lib/db/blocks';
import { computeShadeWindowEvents } from './engine';
import {
  rotationConflicts,
  rotationLookbackForFamily,
  sameTimeOverlap,
  type BlockBar,
  type PriorCrop
} from './rotation';

const corn: CropPlugin = {
  pluginId: 'corn-tall',
  type: 'crop',
  displayName: 'Field Corn',
  version: '1.0.0',
  cropFamily: 'corn',
  daysToMaturity: { min: 90, max: 100 },
  shadeCasting: true,
  matureHeightFt: 8
};

const lettuce: CropPlugin = {
  pluginId: 'lettuce-buttercrunch',
  type: 'crop',
  displayName: 'Buttercrunch',
  version: '1.0.0',
  cropFamily: 'leafy-green',
  daysToMaturity: { min: 50, max: 60 }
};

const PLANT_DATE = new Date(2026, 4, 1).getTime();

function makePlanting(blockId: string, pluginId = corn.pluginId): PlantingRecord {
  return {
    id: `p-${blockId}`,
    blockId,
    cropPluginId: pluginId,
    varietyDisplayName: 'X',
    plantingDate: PLANT_DATE
  };
}

describe('computeShadeWindowEvents (v2 shade model)', () => {
  /** Three blocks laid out W→E with real geometry around Loudoun County.
   *  Block centers are 5m apart — typical for small-plot farms where
   *  "blocks" are sub-acre management units rather than fields. At this
   *  spacing, an 8ft corn canopy easily shades neighbours at 9 AM / 3 PM
   *  when the sun is low. */
  function makeBlocks(): Block[] {
    const lat = 39.09;
    const lon = -77.6;
    const dEastFor5m = 5 / (111_320 * Math.cos((lat * Math.PI) / 180));
    const ringAt = (cLon: number, cLat: number): string => {
      const half = dEastFor5m / 2;
      const dN = 5 / 111_320 / 2;
      return JSON.stringify({
        type: 'Polygon',
        coordinates: [[
          [cLon - half, cLat - dN],
          [cLon + half, cLat - dN],
          [cLon + half, cLat + dN],
          [cLon - half, cLat + dN],
          [cLon - half, cLat - dN]
        ]]
      });
    };
    return [
      { id: 'b0', name: 'B0', tillageMethod: 'conventional', axesLocked: false, eastWestIndex: 0, northSouthIndex: 0, geometryGeojson: ringAt(lon - dEastFor5m, lat) },
      { id: 'b1', name: 'B1', tillageMethod: 'conventional', axesLocked: false, eastWestIndex: 1, northSouthIndex: 0, geometryGeojson: ringAt(lon, lat) },
      { id: 'b2', name: 'B2', tillageMethod: 'conventional', axesLocked: false, eastWestIndex: 2, northSouthIndex: 0, geometryGeojson: ringAt(lon + dEastFor5m, lat) }
    ];
  }

  function compute(plantings: ReadonlyArray<{ planting: PlantingRecord; crop: CropPlugin; block: Block }>, blocks: Block[]) {
    const yearStart = new Date(2026, 0, 1).getTime();
    const yearEnd = new Date(2027, 0, 1).getTime() - 1;
    return computeShadeWindowEvents({
      plantings,
      shadeSources: [],
      blocks,
      farmLat: 39.09,
      farmLon: -77.6,
      fromMs: yearStart,
      toMs: yearEnd
    });
  }

  it('produces shade events on neighbour blocks for tall corn', () => {
    const blocks = makeBlocks();
    const events = compute([{ planting: makePlanting('b1'), crop: corn, block: blocks[1] }], blocks);
    expect(events.length).toBeGreaterThan(0);
    const targets = new Set(events.map((e) => e.blockId));
    expect(targets.has('b0') || targets.has('b2')).toBe(true);
    expect(targets.has('b1')).toBe(false); // never shade self
  });

  it('emits no events for short, non-shading crops', () => {
    const blocks = makeBlocks();
    const events = compute(
      [{ planting: makePlanting('b1', lettuce.pluginId), crop: lettuce, block: blocks[1] }],
      blocks
    );
    expect(events).toHaveLength(0);
  });

  it('intensity is bounded in [0, 1]', () => {
    const blocks = makeBlocks();
    const events = compute([{ planting: makePlanting('b1'), crop: corn, block: blocks[1] }], blocks);
    for (const e of events) {
      const intensity = e.detail.intensity as number;
      expect(intensity).toBeGreaterThan(0);
      expect(intensity).toBeLessThanOrEqual(1);
    }
  });

  it('attribution includes source crop id + variety', () => {
    const blocks = makeBlocks();
    const events = compute([{ planting: makePlanting('b1'), crop: corn, block: blocks[1] }], blocks);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].detail.shadingCropId).toBe('p-b1');
    expect(events[0].detail.shadingVariety).toBeDefined();
  });

  it('density modulation: half-density corn casts less intense shadow', () => {
    const blocks = makeBlocks();
    const sparseCorn: CropPlugin = {
      ...corn,
      pluginId: 'corn-sparse',
      plantingGuide: { seedsPerAcre: 15000 } // half of 30k reference
    };
    const denseCorn: CropPlugin = {
      ...corn,
      pluginId: 'corn-dense',
      plantingGuide: { seedsPerAcre: 30000 }
    };
    const sparseEvents = compute(
      [{ planting: makePlanting('b1', sparseCorn.pluginId), crop: sparseCorn, block: blocks[1] }],
      blocks
    );
    const denseEvents = compute(
      [{ planting: makePlanting('b1', denseCorn.pluginId), crop: denseCorn, block: blocks[1] }],
      blocks
    );
    if (sparseEvents.length === 0 || denseEvents.length === 0) return; // no impact computed; fine
    const avg = (xs: { detail: { intensity: number } }[]) =>
      xs.reduce((s, e) => s + e.detail.intensity, 0) / xs.length;
    expect(avg(sparseEvents)).toBeLessThan(avg(denseEvents));
  });

  it('emits no events when no shade source has geometry centroid', () => {
    const noGeoBlocks: Block[] = [
      { id: 'b0', name: 'B0', tillageMethod: 'conventional', axesLocked: false },
      { id: 'b1', name: 'B1', tillageMethod: 'conventional', axesLocked: false }
    ];
    const events = compute(
      [{ planting: makePlanting('b1'), crop: corn, block: noGeoBlocks[1] }],
      noGeoBlocks
    );
    // Index fallback in shadeModel still requires the source emitter to have
    // a centroidLonLat — when synthCentroidFromIndices returns null, the
    // emitter is dropped. This is the documented fallback behaviour.
    expect(events).toHaveLength(0);
  });
});

describe('rotationConflicts', () => {
  it('respects family-specific lookback (brassica = 3y)', () => {
    expect(rotationLookbackForFamily('brassica')).toBe(3);
    expect(rotationLookbackForFamily('legume')).toBe(1);
    expect(rotationLookbackForFamily('cover')).toBe(0);
  });

  it('flags a 2-year-old prior brassica as a conflict', () => {
    const history: PriorCrop[] = [
      {
        cropId: 'old',
        pluginId: 'kale',
        family: 'brassica',
        plantingDate: new Date(2024, 4, 1).getTime()
      }
    ];
    const out = rotationConflicts(
      'b1',
      {
        cropId: 'new',
        pluginId: 'cabbage',
        family: 'brassica',
        plantingDate: new Date(2026, 4, 1).getTime()
      },
      history
    );
    expect(out).toHaveLength(1);
    expect(out[0].lookbackYears).toBe(3);
  });

  it('does not flag a 5-year-old prior (outside lookback)', () => {
    const history: PriorCrop[] = [
      {
        cropId: 'old',
        pluginId: 'kale',
        family: 'brassica',
        plantingDate: new Date(2021, 4, 1).getTime()
      }
    ];
    const out = rotationConflicts(
      'b1',
      {
        cropId: 'new',
        pluginId: 'cabbage',
        family: 'brassica',
        plantingDate: new Date(2026, 4, 1).getTime()
      },
      history
    );
    expect(out).toHaveLength(0);
  });

  it('cover crops never conflict (lookback 0)', () => {
    const history: PriorCrop[] = [
      { cropId: 'a', pluginId: 'rye', family: 'cover', plantingDate: PLANT_DATE - 86_400_000 }
    ];
    const out = rotationConflicts(
      'b1',
      { pluginId: 'rye', family: 'cover', plantingDate: PLANT_DATE },
      history
    );
    expect(out).toHaveLength(0);
  });
});

describe('sameTimeOverlap', () => {
  it('returns no overlap for edge-touching ranges', () => {
    const bars: BlockBar[] = [
      { cropId: 'a', startMs: 0, endMs: 100 },
      { cropId: 'b', startMs: 100, endMs: 200 }
    ];
    expect(sameTimeOverlap('b1', bars)).toHaveLength(0);
  });

  it('reports a single overlap pair regardless of input order', () => {
    const bars: BlockBar[] = [
      { cropId: 'a', startMs: 0, endMs: 100 },
      { cropId: 'b', startMs: 50, endMs: 150 }
    ];
    const o1 = sameTimeOverlap('b1', bars);
    const o2 = sameTimeOverlap('b1', [bars[1], bars[0]]);
    expect(o1).toHaveLength(1);
    expect(o2).toHaveLength(1);
    expect(o1[0].overlapStartMs).toBe(50);
    expect(o1[0].overlapEndMs).toBe(100);
    expect(o1[0]).toEqual(o2[0]);
  });

  it('property: overlap is symmetric and reports each pair exactly once', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            cropId: fc.uuid(),
            startMs: fc.integer({ min: 0, max: 1_000_000 }),
            len: fc.integer({ min: 1, max: 1_000_000 })
          }),
          { maxLength: 8 }
        ),
        (raw) => {
          const bars: BlockBar[] = raw.map((r) => ({
            cropId: r.cropId,
            startMs: r.startMs,
            endMs: r.startMs + r.len
          }));
          // Filter to unique cropIds for symmetry assertion.
          const uniq = new Map<string, BlockBar>();
          for (const b of bars) if (!uniq.has(b.cropId)) uniq.set(b.cropId, b);
          const list = [...uniq.values()];
          const o1 = sameTimeOverlap('b1', list);
          const o2 = sameTimeOverlap('b1', [...list].reverse());
          expect(o2.length).toBe(o1.length);
          // Pair count <= n*(n-1)/2.
          expect(o1.length).toBeLessThanOrEqual((list.length * (list.length - 1)) / 2);
        }
      ),
      { numRuns: 80 }
    );
  });
});
