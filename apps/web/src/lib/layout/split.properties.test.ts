import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { BlockWithPlantings } from '$lib/db/blocks';
import type { Crop } from '$lib/db/crops';
import { planLayout, type Assignment, type PlanInput, type SeedRequest } from './engine';
import { blockStatusFor, fieldShareUsed, roomFor } from './split';
import { BED_SHARE_CAP, bedPlantsFit, freeBedShare, SHARE_EPSILON } from './bedSharing';

const NOW = Date.UTC(2026, 9, 2);
const YEAR = 365 * 86_400_000;

function plugin(id: string, family: string, rowIn: number, inRowIn: number): CropPlugin {
  return {
    pluginId: id,
    type: 'crop',
    displayName: id,
    version: '1.0.0',
    cropFamily: family,
    defaultRowSpacingInches: rowIn,
    plantingGuide: { rowSpacingIn: rowIn, inRowSpacingIn: { min: inRowIn, max: inRowIn } },
    daysToMaturity: { min: 50, max: 80 }
  } as CropPlugin;
}

const PLUGINS: Record<string, CropPlugin> = {
  lettuce: plugin('lettuce', 'leafy-green', 12, 8),
  kale: plugin('kale', 'leafy-green', 18, 12),
  bean: plugin('bean', 'legume', 18, 4),
  onion: plugin('onion', 'allium', 12, 4),
  cabbage: plugin('cabbage', 'brassica', 24, 18),
  broccoli: plugin('broccoli', 'brassica', 24, 18),
  cornA: plugin('cornA', 'corn', 30, 9),
  cornB: plugin('cornB', 'corn', 30, 9),
  squash: plugin('squash', 'cucurbit', 60, 36),
  tomato: plugin('tomato', 'solanaceae', 36, 24)
};
const IDS = Object.keys(PLUGINS);
const SUNS = ['full', 'partial', 'shade', undefined] as const;

const blockArb = fc.record({
  bed: fc.boolean(),
  acres: fc.double({ min: 0.00005, max: 0.03, noNaN: true }),
  w: fc.integer({ min: 1, max: 6 }),
  l: fc.integer({ min: 1, max: 30 }),
  sun: fc.constantFrom(...SUNS)
});

const seedArb = fc.record({
  crop: fc.constantFrom(...IDS),
  qty: fc.integer({ min: 1, max: 4000 }),
  fill: fc.boolean(),
  keep: fc.boolean(),
  sun: fc.constantFrom(...SUNS)
});

const existingArb = fc.record({
  blockIdx: fc.nat(),
  crop: fc.constantFrom(...IDS),
  status: fc.constantFrom('active', 'planned', 'harvested', 'archived'),
  qty: fc.option(fc.integer({ min: 1, max: 300 }), { nil: null }),
  yearsAgo: fc.double({ min: 0, max: 6, noNaN: true })
});

const pairArb = fc.tuple(fc.constantFrom(...IDS), fc.constantFrom(...IDS));

const planInputArb = fc
  .record({
    blocks: fc.array(blockArb, { minLength: 1, maxLength: 5 }),
    seeds: fc.array(seedArb, { minLength: 1, maxLength: 5 }),
    existing: fc.array(existingArb, { maxLength: 5 }),
    bad: fc.array(pairArb, { maxLength: 3 })
  })
  .map(({ blocks, seeds, existing, bad }): PlanInput => {
    const bs: BlockWithPlantings[] = blocks.map(
      (b, i) =>
        ({
          id: `b${i}`,
          name: `b${i}`,
          acres: b.bed ? (b.w * b.l) / 43_560 : b.acres,
          widthFt: b.bed ? b.w : undefined,
          lengthFt: b.bed ? b.l : undefined,
          tillageMethod: 'conventional',
          axesLocked: false,
          sunExposure: b.sun,
          plantings: []
        }) as BlockWithPlantings
    );
    const ss: SeedRequest[] = seeds.map((s, i) => ({
      stockItemId: `s${i}`,
      cropPluginId: s.crop,
      varietyDisplayName: `s${i}`,
      quantityPlants: s.qty,
      ...(s.sun ? { sunRequirement: s.sun } : {}),
      ...(s.fill ? { fillToCapacity: true } : {}),
      ...(s.keep && !s.fill ? { keepInOneBed: true } : {})
    }));
    const ex: Crop[] = existing.map(
      (e, i) =>
        ({
          id: `c${i}`,
          blockId: bs[e.blockIdx % bs.length].id,
          cropPluginId: e.crop,
          status: e.status,
          quantityPlanted: e.qty,
          plantingDate: NOW - e.yearsAgo * YEAR
        }) as Crop
    );
    const companions: Record<string, { goodWith: string[]; badWith: string[] }> = {};
    for (const [a, b] of bad) {
      if (a === b) continue;
      (companions[a] ??= { goodWith: [], badWith: [] }).badWith.push(b);
      (companions[b] ??= { goodWith: [], badWith: [] }).badWith.push(a);
    }
    return {
      seeds: ss,
      blocks: bs,
      axes: bs.map((b, i) => ({ blockId: b.id, east: i % 3, north: Math.floor(i / 3) })),
      existingCrops: ex,
      pluginIndex: PLUGINS,
      companions,
      bedBlockIds: blocks.flatMap((b, i) => (b.bed ? [`b${i}`] : [])),
      nowMs: NOW
    };
  });

function placedBy(assignments: ReadonlyArray<Assignment>, id: string): number {
  return assignments.filter((a) => a.stockItemId === id).reduce((s, a) => s + a.plants, 0);
}

const RUNS = { numRuns: 300 };

describe('split engine properties', () => {
  it('never overfills a block (R-10)', () => {
    fc.assert(
      fc.property(planInputArb, (input) => {
        const r = planLayout(input);
        r.assignments.forEach((a, i) => {
          expect(Number.isInteger(a.plants)).toBe(true);
          expect(a.plants).toBeGreaterThanOrEqual(1);
          expect(a.plants).toBeLessThanOrEqual(
            roomFor(input, a, a.blockId, r.assignments.slice(0, i))
          );
        });
        const beds = new Set(input.bedBlockIds ?? []);
        for (const b of input.blocks) {
          const mine = r.assignments.filter((a) => a.blockId === b.id);
          if (mine.length === 0) continue;
          if (beds.has(b.id)) {
            const used = mine.reduce(
              (s, a) => s + a.plants / bedPlantsFit(b, PLUGINS[a.cropPluginId]),
              0
            );
            expect(used).toBeLessThanOrEqual(
              freeBedShare(b, input.existingCrops, input.pluginIndex) + SHARE_EPSILON * 10
            );
          } else {
            const before = fieldShareUsed(input, b.id, []);
            expect(fieldShareUsed(input, b.id, r.assignments)).toBeLessThanOrEqual(
              Math.max(BED_SHARE_CAP, before) + SHARE_EPSILON * 10
            );
          }
        }
      }),
      RUNS
    );
  });

  it('conserves every counted plant: placed plus left over is the count (R-08, R-11)', () => {
    fc.assert(
      fc.property(planInputArb, (input) => {
        const r = planLayout(input);
        for (const s of input.seeds) {
          const got = placedBy(r.assignments, s.stockItemId);
          if (s.fillToCapacity) {
            expect(got).toBeLessThanOrEqual(s.quantityPlants);
            expect(
              new Set(
                r.assignments.filter((a) => a.stockItemId === s.stockItemId).map((a) => a.blockId)
              ).size
            ).toBeLessThanOrEqual(1);
            expect(r.leftover.some((l) => l.stockItemId === s.stockItemId)).toBe(false);
            continue;
          }
          const report = r.leftover.find((l) => l.stockItemId === s.stockItemId);
          const rest = r.unplaced.find((u) => u.stockItemId === s.stockItemId);
          expect(got + (report?.plantsLeft ?? 0)).toBe(s.quantityPlants);
          expect(rest?.quantityPlants ?? 0).toBe(report?.plantsLeft ?? 0);
        }
      }),
      RUNS
    );
  });

  it('reports leftover only when every picked block is full or ruled out', () => {
    fc.assert(
      fc.property(planInputArb, (input) => {
        const r = planLayout(input);
        for (const report of r.leftover) {
          const s = input.seeds.find((x) => x.stockItemId === report.stockItemId)!;
          for (const b of input.blocks) {
            expect(blockStatusFor(input, s, b.id, r.assignments)).not.toBeNull();
          }
          expect(report.blocks.map((x) => x.blockId)).toEqual(input.blocks.map((b) => b.id));
        }
      }),
      RUNS
    );
  });

  it('keeps a keep-in-one-bed lot on one block', () => {
    fc.assert(
      fc.property(planInputArb, (input) => {
        const r = planLayout(input);
        for (const s of input.seeds.filter((x) => x.keepInOneBed)) {
          const blocks = new Set(
            r.assignments.filter((a) => a.stockItemId === s.stockItemId).map((a) => a.blockId)
          );
          expect(blocks.size).toBeLessThanOrEqual(1);
        }
      }),
      RUNS
    );
  });

  it('never puts a part next to a keep-apart crop', () => {
    fc.assert(
      fc.property(planInputArb, (input) => {
        const r = planLayout(input);
        for (const a of r.assignments) {
          const bad = input.companions[a.cropPluginId]?.badWith ?? [];
          const existing = input.existingCrops.filter(
            (c) =>
              c.blockId === a.blockId &&
              !['archived', 'failed', 'harvested'].includes(c.status) &&
              bad.includes(c.cropPluginId)
          );
          expect(existing).toEqual([]);
          const neighbours = r.assignments.filter(
            (o) => o.blockId === a.blockId && bad.includes(o.cropPluginId)
          );
          expect(neighbours).toEqual([]);
        }
      }),
      RUNS
    );
  });

  it('covers splits, leftovers and keep lots in the generated farms', () => {
    let split = 0;
    let left = 0;
    let kept = 0;
    fc.assert(
      fc.property(planInputArb, (input) => {
        const r = planLayout(input);
        for (const s of input.seeds) {
          const blocks = new Set(
            r.assignments.filter((a) => a.stockItemId === s.stockItemId).map((a) => a.blockId)
          );
          if (blocks.size > 1) split++;
          if (s.keepInOneBed && r.leftover.some((l) => l.stockItemId === s.stockItemId)) kept++;
        }
        if (r.leftover.length > 0) left++;
      }),
      { numRuns: 300, seed: 35 }
    );
    expect(split).toBeGreaterThan(20);
    expect(left).toBeGreaterThan(20);
    expect(kept).toBeGreaterThan(5);
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(planInputArb, (input) => {
        expect(planLayout(input)).toEqual(planLayout(input));
      }),
      { numRuns: 100 }
    );
  });
});
