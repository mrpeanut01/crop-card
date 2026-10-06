import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { BlockWithPlantings } from '$lib/db/blocks';
import { inRowSpacingOf, plantCount, resolveSpacing, rowSpacingOf } from '$lib/garden/plantCount';
import { footprintSqFt, plantsFitUsable } from '$lib/layout/sufficiency';
import { bedPlantsFit } from '$lib/layout/bedSharing';
import { planLayout, type SeedRequest } from '$lib/layout/engine';
import { isNarrow } from '$lib/layout/split';
import { planBeds } from './bedLayout';

/**
 * #555: golden values recorded before area mode landed. Every crop that is
 * not sown by area (it has an in-row spacing, or no seeding rate at all)
 * must keep exactly these footprints, plant counts and layouts.
 */

const CROPS_DIR = resolve(__dirname, '../../../../../plugins/crops');

const all = readdirSync(CROPS_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(resolve(CROPS_DIR, f), 'utf8')) as CropPlugin);

const inRow = all.filter(
  (p) => !(p.plantingGuide?.seedingRate && !p.plantingGuide?.inRowSpacingIn)
);

function spacingInput(p: CropPlugin) {
  const g = p.plantingGuide ?? {};
  return {
    defaultRowSpacingInches: p.defaultRowSpacingInches ?? null,
    rowSpacingIn: g.rowSpacingIn ?? null,
    inRowSpacingIn: g.inRowSpacingIn ?? null,
    vineSpreadFt: g.vineSpreadFt ?? null,
    matureCanopyFtSq: g.matureCanopyFtSq ?? null,
    seedingRate: g.seedingRate ?? null,
    ...(p.treeSizeClasses ? { treeSizeClasses: p.treeSizeClasses } : {})
  };
}

function block(id: string, extra: Partial<BlockWithPlantings>): BlockWithPlantings {
  return { id, name: id, acres: 0.1, plantings: [], ...extra } as unknown as BlockWithPlantings;
}

function frozen(
  pluginId: string,
  cropFamily: string,
  guide: Record<string, unknown>,
  defaultRowSpacingInches?: number
): CropPlugin {
  return {
    pluginId,
    type: 'crop',
    displayName: pluginId,
    version: '1.0.0',
    cropFamily,
    ...(defaultRowSpacingInches ? { defaultRowSpacingInches } : {}),
    plantingGuide: guide,
    daysToMaturity: { min: 50, max: 80 }
  } as unknown as CropPlugin;
}

/** Fixed copies, so a data edit to a crop plugin never moves this golden. */
const FROZEN: CropPlugin[] = [
  frozen('tomato', 'solanaceae', { rowSpacingIn: 48, inRowSpacingIn: { min: 18, max: 24 } }, 48),
  frozen('lettuce', 'leafy-green', { rowSpacingIn: 12, inRowSpacingIn: { min: 8, max: 12 } }),
  frozen('bean', 'legume', { rowSpacingIn: 18, inRowSpacingIn: { min: 2, max: 4 } }),
  frozen('squash', 'cucurbit', {
    inRowSpacingIn: { min: 36, max: 48 },
    vineSpreadFt: { min: 6, max: 10 }
  }),
  frozen('onion', 'allium', { rowSpacingIn: 12, inRowSpacingIn: { min: 4, max: 4 } }),
  frozen('kale', 'brassica', { rowSpacingIn: 24, inRowSpacingIn: { min: 12, max: 18 } }),
  frozen('mystery', 'herb-culinary', {}, 30),
  frozen('nothing', 'root', {}),
  frozen('melon', 'cucurbit', { matureCanopyFtSq: 16, inRowSpacingIn: { min: 24, max: 36 } }),
  frozen('corn', 'corn', { rowSpacingIn: 30, inRowSpacingIn: { min: 8, max: 12 } })
];

const FIELD = block('field', { acres: 0.1 });
const BED = block('bed', { acres: 100 / 43_560, widthFt: 4, lengthFt: 25 });

describe('in-row crops keep their pre-#555 spacing math', () => {
  it('per-crop footprints, spacing and plant counts', () => {
    const rows = inRow.map((p) => {
      const fp = { w_in: 48, l_in: 96 };
      return {
        id: p.pluginId,
        input: spacingInput(p),
        footprintSqFt: footprintSqFt(p),
        row: rowSpacingOf(p),
        inRow: inRowSpacingOf(p),
        spacing: resolveSpacing(p as never, 'square'),
        square: plantCount(fp, resolveSpacing(p as never, 'square')),
        offset: plantCount(fp, resolveSpacing(p as never, 'offset')),
        sfg: plantCount(fp, resolveSpacing(p as never, 'sfg')),
        fieldFit: plantsFitUsable(FIELD, p),
        bedFit: bedPlantsFit(BED, p),
        narrowBed: isNarrow(BED, p, true),
        narrowField: isNarrow(FIELD, p, false)
      };
    });
    const file = resolve(__dirname, '__golden__/inRowCrops.json');
    if (process.env.GOLDEN_WRITE === '1') writeFileSync(file, JSON.stringify(rows, null, 1) + '\n');
    const golden = JSON.parse(readFileSync(file, 'utf8')) as Array<{ id: string; input: unknown }>;
    const now = new Map(rows.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    let compared = 0;
    for (const g of golden) {
      const cur = now.get(g.id);
      // A crop whose spacing data changed since the golden run is not a code
      // regression; only crops with the same inputs are compared.
      if (!cur || JSON.stringify(cur.input) !== JSON.stringify(g.input)) continue;
      expect(cur, g.id).toEqual(g);
      compared++;
    }
    expect(compared).toBeGreaterThan(golden.length * 0.8);
  });

  it('engine and bed layout output on real in-row crops', () => {
    const pick = FROZEN;
    const pluginIndex = Object.fromEntries(pick.map((p) => [p.pluginId, p]));
    const blocks = [
      block('f1', { acres: 0.05 }),
      block('f2', { acres: 0.02 }),
      block('b1', { acres: 100 / 43_560, widthFt: 4, lengthFt: 25 }),
      block('b2', { acres: 60 / 43_560, widthFt: 3, lengthFt: 20 })
    ];
    const seeds: SeedRequest[] = pick.map((p, i) => ({
      stockItemId: `st_${i}`,
      cropPluginId: p.pluginId,
      varietyDisplayName: p.pluginId,
      quantityPlants: 20 + i * 37
    }));
    const plan = planLayout({
      seeds,
      blocks,
      axes: blocks.map((b, i) => ({ blockId: b.id, east: i, north: 0 })),
      existingCrops: [],
      pluginIndex,
      companions: {},
      bedBlockIds: ['b1', 'b2'],
      nowMs: Date.UTC(2026, 9, 1)
    });
    const beds = planBeds(
      pick.map((p, i) => ({
        key: `st_${i}`,
        name: p.pluginId,
        family: p.cropFamily ?? null,
        plants: 20 + i * 37,
        inRowIn: inRowSpacingOf(p).inches,
        rowIn: rowSpacingOf(p).inches
      })),
      { bedWidthFt: 4, maxBedLengthFt: 25 }
    );
    const file = resolve(__dirname, '__golden__/inRowLayout.json');
    if (process.env.GOLDEN_WRITE === '1') {
      writeFileSync(file, JSON.stringify({ plan, beds }, null, 1) + '\n');
    }
    expect(JSON.parse(JSON.stringify({ plan, beds }))).toEqual(
      JSON.parse(readFileSync(file, 'utf8'))
    );
  });
});
