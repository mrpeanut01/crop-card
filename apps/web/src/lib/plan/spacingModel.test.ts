import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { BlockWithPlantings } from '$lib/db/blocks';
import { footprintForCount, plantCount, resolveSpacing } from '$lib/garden/plantCount';
import { footprintSqFt, plantsFitUsable } from '$lib/layout/sufficiency';
import { bedPlantsFit } from '$lib/layout/bedSharing';
import { isNarrow } from '$lib/layout/split';
import { resolvePlacement } from '$lib/server/garden/placement';
import { placedPlanting } from '$lib/garden/design';
import { checkBedProposal, planBeds } from './bedLayout';
import {
  AREA_UNIT_SQFT,
  areaForSeed,
  areaRate,
  defaultSowMethod,
  formatSeedAmount,
  seedAmountFor,
  sowMethods,
  spacingModel
} from './spacingModel';
import { seedAmountLine } from './seedAmountText';

const CROPS_DIR = resolve(__dirname, '../../../../../plugins/crops');
const ALL = readdirSync(CROPS_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(CROPS_DIR, f), 'utf8')) as CropPlugin);
const AREA = ALL.filter((p) => p.plantingGuide?.seedingRate && !p.plantingGuide?.inRowSpacingIn);

const RYE = {
  plantingGuide: {
    seedingRate: {
      drilledLbsPerAcre: { min: 60, max: 120 },
      broadcastLbsPerAcre: { min: 90, max: 160 },
      seedBasis: 'bulk' as const
    }
  }
};
const BUCKWHEAT = { plantingGuide: { seedingRate: { drilledLbsPerAcre: { min: 50, max: 60 } } } };
const BARLEY = { plantingGuide: { seedingRate: { drilledSeedsPerSqFt: { min: 30, max: 30 } } } };
const CORN = { plantingGuide: { seedingRate: { seedsPerAcre: { min: 25_000, max: 33_000 } } } };
const ALFALFA = { plantingGuide: { seedingRate: { drillRowSpacingIn: { min: 6, max: 8 } } } };

describe('spacingModel', () => {
  it('sorts crops into in-row, area and unknown', () => {
    expect(spacingModel({ plantingGuide: { inRowSpacingIn: { min: 18, max: 24 } } }).kind).toBe(
      'in-row'
    );
    expect(spacingModel(RYE).kind).toBe('area');
    expect(spacingModel(ALFALFA)).toEqual({
      kind: 'area',
      rates: [],
      drillRowIn: { min: 6, max: 8 }
    });
    expect(spacingModel({ defaultRowSpacingInches: 30 }).kind).toBe('unknown');
    expect(spacingModel(undefined).kind).toBe('unknown');
  });

  it('never reads the unsourced legacy seed fields', () => {
    const legacy = {
      plantingGuide: { seedsPerAcre: 1_200_000, recommendedLbsPerAcre: 90, seedsPerLb: 18_000 }
    };
    expect(spacingModel(legacy as never).kind).toBe('unknown');
    expect(areaForSeed(spacingModel(legacy as never), null, 50, 'lb')).toBeNull();
  });

  it('starts on Broadcast when the plugin has both rates, else the one it has', () => {
    expect(sowMethods(spacingModel(RYE))).toEqual(['broadcast', 'drilled']);
    expect(defaultSowMethod(spacingModel(RYE))).toBe('broadcast');
    expect(defaultSowMethod(spacingModel(BUCKWHEAT))).toBe('drilled');
    expect(defaultSowMethod(spacingModel(CORN))).toBe('planted');
    expect(defaultSowMethod(spacingModel(ALFALFA))).toBeNull();
    // A method the plugin has no rate for answers with the one it has, named.
    expect(areaRate(spacingModel(BUCKWHEAT), 'broadcast')?.method).toBe('drilled');
  });

  it('sizes the area at the high end of the rate (AM-1)', () => {
    const model = spacingModel(RYE);
    const area = areaForSeed(model, 'broadcast', 50, 'lb')!;
    expect(area.provenance).toBe('data');
    expect(area.sqft).toBeCloseTo((50 / 160) * 43_560, 6);
    expect(areaForSeed(model, 'drilled', 16, 'oz')!.sqft).toBeCloseTo((1 / 120) * 43_560, 6);
    // The seed for that area never needs more than is on hand.
    const amount = seedAmountFor(model, 'broadcast', area.sqft)!;
    expect(amount.kind === 'weight' && amount.lb.max).toBeCloseTo(50, 9);
  });

  it('leaves the area unknown for a weight against a seed-count rate (AM-2)', () => {
    expect(areaForSeed(spacingModel(BARLEY), null, 10, 'lb')).toBeNull();
    expect(areaForSeed(spacingModel(CORN), null, 2, 'lb')).toBeNull();
    expect(areaForSeed(spacingModel(BARLEY), null, 3000, 'seeds')!.sqft).toBe(100);
    expect(areaForSeed(spacingModel(CORN), null, 33_000, 'seeds')!.sqft).toBeCloseTo(43_560, 6);
  });

  it("uses the farmer's own rate, tagged manual", () => {
    const area = areaForSeed(spacingModel(ALFALFA), null, 1, 'lb', 20)!;
    expect(area).toEqual({ sqft: 43_560 / 20, provenance: 'manual' });
    const amount = seedAmountFor(spacingModel(ALFALFA), null, 43_560 / 20, 20)!;
    expect(amount.provenance).toBe('manual');
    expect(seedAmountFor(spacingModel(ALFALFA), null, 1000)).toBeNull();
  });

  it('gives the range, never a midpoint, and reads ounces under a pound (AM-4)', () => {
    const model = spacingModel(RYE);
    const amount = seedAmountFor(model, 'broadcast', 1200)!;
    expect(amount).toMatchObject({ kind: 'weight', method: 'broadcast', provenance: 'data' });
    expect(formatSeedAmount(amount, 'us')).toBe('2.4–4.5 lb');
    expect(formatSeedAmount(seedAmountFor(model, 'broadcast', 100)!, 'us')).toBe('3.3–5.9 oz');
    expect(formatSeedAmount(seedAmountFor(model, 'broadcast', 100)!, 'metric')).toBe('93–167 g');
    expect(formatSeedAmount(seedAmountFor(model, 'broadcast', 43_560)!, 'us')).toBe('90–160 lb');
  });

  it('rounds each end outward', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 500, noNaN: true }),
        fc.double({ min: 0, max: 3, noNaN: true }),
        (min, extra) => {
          const max = min + extra;
          const text = formatSeedAmount(
            { kind: 'weight', method: 'drilled', lb: { min, max }, provenance: 'data' },
            'us'
          );
          const nums = text
            .replace(/,/g, '')
            .match(/[\d.]+/g)!
            .map(Number);
          const oz = text.endsWith('oz');
          const k = oz ? 16 : 1;
          expect(nums[0]).toBeLessThanOrEqual(min * k + 1e-9);
          expect(nums[nums.length - 1]).toBeGreaterThanOrEqual(max * k - 1e-9);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('says "not known" with no number when the crop has no rate', () => {
    const line = seedAmountLine(spacingModel(ALFALFA), null, 1200, 'us');
    expect(line.provenance).toBeNull();
    expect(line.text).not.toMatch(/\d/);
    const es = seedAmountLine(spacingModel(ALFALFA), null, 1200, 'us', 'es');
    expect(es.text).toMatch(/^No se sabe/);
    expect(seedAmountLine(spacingModel(RYE), 'broadcast', 1200, 'us').text).toBe(
      'Broadcast: 2.4–4.5 lb for 1,200 sq ft'
    );
  });
});

function block(extra: Partial<BlockWithPlantings>): BlockWithPlantings {
  return { id: 'b', name: 'b', plantings: [], ...extra } as unknown as BlockWithPlantings;
}

describe('crops sown by area get no plant count or plant-sized bed (#555)', () => {
  it('covers the area crops in the library', () => {
    expect(AREA.length).toBeGreaterThanOrEqual(20);
    expect(AREA.map((p) => p.pluginId)).toContain('cereal-rye-cover');
  });

  it.each(AREA.map((p) => [p.pluginId, p] as const))('%s', (_id, plugin) => {
    expect(spacingModel(plugin).kind).toBe('area');
    const spacing = resolveSpacing(plugin as never, 'square', { inRowIn: 6, rowIn: 6 });
    expect(spacing.mode).toBe('area');
    const fp = { x_in: 0, y_in: 0, w_in: 48, l_in: 120 };
    expect(plantCount(fp, spacing).count).toBeNull();
    for (const pattern of ['square', 'offset', 'sfg'] as const) {
      expect(plantCount(fp, resolveSpacing(plugin as never, pattern)).count).toBeNull();
    }
    expect(
      resolvePlacement(
        { footprint: fp, spacingPattern: 'square', plantCount: 900 },
        plugin as never
      ).plantCount
    ).toBeNull();
    const placed = placedPlanting(
      {
        id: 'c',
        blockId: 'b',
        cropPluginId: plugin.pluginId,
        varietyDisplayName: plugin.displayName,
        status: 'planned',
        plantingDateMs: null,
        harvestedAtMs: null,
        footprint: fp,
        spacingPattern: 'square',
        spacingIn: 12,
        rowSpacingIn: null,
        plantCount: 900_000,
        plantCountProvenance: 'fallback',
        groupId: null,
        groupSystemKind: null
      } as never,
      plugin as never
    );
    expect(placed.plantCount).toBeNull();
    // Engine units are square feet: the bed holds its own area of the crop.
    expect(footprintSqFt(plugin)).toBe(AREA_UNIT_SQFT);
    const bed = block({ widthFt: 4, lengthFt: 25, acres: 100 / 43_560 });
    expect(bedPlantsFit(bed, plugin)).toBe(100);
    expect(plantsFitUsable(block({ acres: 1 }), plugin)).toBe(Math.floor(43_560 * 0.85));
    expect(isNarrow(block({ widthFt: 1, lengthFt: 3 }), plugin, true)).toBe(false);
    // The footprint for an amount is its area, not a count of 12 in plants.
    const want = footprintForCount(100, spacing, 48);
    expect(want.w_in * want.l_in).toBeGreaterThanOrEqual(100 * 144);
    expect(want.w_in * want.l_in).toBeLessThan(108 * 144);
  });
});

describe('bed layout for a crop sown by area', () => {
  const rye = {
    key: 'rye',
    name: 'Rye',
    family: 'cover-grass',
    plants: 300,
    inRowIn: 12,
    rowIn: 12,
    byArea: true
  };

  it('gives it ground with no rows of plants', () => {
    const { beds, unplaced } = planBeds([rye], { bedWidthFt: 4, maxBedLengthFt: 25 });
    expect(unplaced).toEqual([]);
    const segs = beds.flatMap((b) => b.crops);
    expect(segs.every((c) => c.rows === 0 && c.areaSqFt === c.plants)).toBe(true);
    expect(segs.reduce((s, c) => s + (c.areaSqFt ?? 0), 0)).toBe(300);
    for (const b of beds)
      expect(b.lengthFt * b.widthFt).toBeGreaterThanOrEqual(
        b.crops.reduce((s, c) => s + (c.areaSqFt ?? 0), 0)
      );
  });

  it('refuses a plant count for it and checks square feet', () => {
    const opts = { bedWidthFt: 4, maxBedLengthFt: 25 };
    expect(
      checkBedProposal(
        [{ widthFt: 4, lengthFt: 25, crops: [{ key: 'rye', plants: 300 }] }],
        [rye],
        opts
      )
    ).toEqual({ ok: false, reason: 'plant count for a crop sown by area' });
    const ok = checkBedProposal(
      [
        { widthFt: 4, lengthFt: 25, crops: [{ key: 'rye', areaSqFt: 100 }] },
        { widthFt: 4, lengthFt: 25, crops: [{ key: 'rye', areaSqFt: 100 }] },
        { widthFt: 4, lengthFt: 25, crops: [{ key: 'rye', areaSqFt: 100 }] }
      ],
      [rye],
      opts
    );
    expect(ok.ok).toBe(true);
    expect(
      checkBedProposal(
        [{ widthFt: 4, lengthFt: 25, crops: [{ key: 'rye', areaSqFt: 300 }] }],
        [rye],
        opts
      ).ok
    ).toBe(false);
  });

  it('places every square foot whatever the bed (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3000 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 4, max: 60 }),
        (sqft, width, maxLen) => {
          const crop = { ...rye, plants: sqft };
          const { beds, unplaced } = planBeds([crop], {
            bedWidthFt: width,
            maxBedLengthFt: maxLen
          });
          const placed = beds.flatMap((b) => b.crops).reduce((s, c) => s + (c.areaSqFt ?? 0), 0);
          const left = unplaced.reduce((s, u) => s + u.plants, 0);
          expect(placed + left).toBe(sqft);
          for (const b of beds) {
            expect(b.crops.every((c) => c.rows === 0)).toBe(true);
            expect(b.lengthFt).toBeLessThanOrEqual(maxLen);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
