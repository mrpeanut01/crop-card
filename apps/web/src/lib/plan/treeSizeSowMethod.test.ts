import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import { resolveSpacing } from '$lib/garden/plantCount';
import { defaultSowMethod, plantingSowMethod, seedAmountFor, spacingModel } from './spacingModel';

const CROPS_DIR = resolve(__dirname, '../../../../../plugins/crops');
const ALL = readdirSync(CROPS_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(CROPS_DIR, f), 'utf8')) as CropPlugin);

describe('#548 tree size classes', () => {
  const ROWS = [
    { sizeClass: 'standard', minSpacingFt: 30, yearsToBearing: { min: 6, max: 10 } },
    { sizeClass: 'dwarf', minSpacingFt: 8, yearsToBearing: { min: 2, max: 3 } },
    { sizeClass: 'semi-dwarf', minSpacingFt: 18, yearsToBearing: { min: 4, max: 6 } }
  ] as const;
  const apple = { treeSizeClasses: ROWS, plantingGuide: { rowSpacingIn: 168 } };
  const TREES = ALL.filter((p) => p.treeSizeClasses?.length && !p.plantingGuide?.inRowSpacingIn);

  it('the planting class sets spacing both ways, tagged plugin', () => {
    const m = spacingModel(apple, 'dwarf');
    expect(m).toMatchObject({ kind: 'tree', known: true, spacingIn: 96, provenance: 'plugin' });
    const s = resolveSpacing(apple as never, 'square', undefined, 'semi-dwarf');
    expect(s).toMatchObject({ inRowIn: 216, rowIn: 216, source: 'plugin' });
  });

  it('not sure, or a class the table lacks, uses the widest class as fallback', () => {
    for (const cls of [null, undefined, 'mini', 'giant']) {
      expect(spacingModel(apple, cls)).toMatchObject({
        kind: 'tree',
        known: false,
        spacingIn: 360,
        provenance: 'fallback'
      });
    }
    const pear = { treeSizeClasses: [ROWS[0]] };
    expect(spacingModel(pear, 'dwarf')).toMatchObject({ known: false, spacingIn: 360 });
    expect(resolveSpacing(apple as never, 'square')).toMatchObject({
      inRowIn: 360,
      rowIn: 360,
      source: 'fallback'
    });
  });

  it('a typed spacing still wins as manual', () => {
    const s = resolveSpacing(apple as never, 'square', { inRowIn: 120, rowIn: 144 }, 'dwarf');
    expect(s).toMatchObject({ inRowIn: 120, rowIn: 144, source: 'manual' });
  });

  it('classes are ordered smallest tree first', () => {
    const m = spacingModel(apple);
    expect(m.kind === 'tree' && m.classes.map((r) => r.sizeClass)).toEqual([
      'dwarf',
      'semi-dwarf',
      'standard'
    ]);
  });

  it('an in-row spacing still wins over the table', () => {
    const both = { ...apple, plantingGuide: { inRowSpacingIn: { min: 12, max: 12 } } };
    expect(spacingModel(both, 'dwarf').kind).toBe('in-row');
  });

  it('capacity never overstates: not sure is never denser than any known class', () => {
    expect(TREES.length).toBeGreaterThan(0);
    for (const p of TREES) {
      const unknown = resolveSpacing(p as never, 'square').inRowIn;
      for (const r of p.treeSizeClasses ?? []) {
        expect(unknown).toBeGreaterThanOrEqual(
          resolveSpacing(p as never, 'square', undefined, r.sizeClass).inRowIn
        );
      }
    }
  });
});

describe('#555 saved sowing method', () => {
  const both = {
    plantingGuide: {
      seedingRate: {
        broadcastLbsPerAcre: { min: 90, max: 160 },
        drilledLbsPerAcre: { min: 60, max: 120 }
      }
    }
  };

  it('uses the saved method when the plugin has its rate, else the default', () => {
    const m = spacingModel(both);
    expect(plantingSowMethod(m, 'drilled')).toBe('drilled');
    expect(plantingSowMethod(m, 'broadcast')).toBe('broadcast');
    expect(plantingSowMethod(m, null)).toBe(defaultSowMethod(m));
    expect(plantingSowMethod(m, 'planted')).toBe(defaultSowMethod(m));
    const drilledOnly = spacingModel({
      plantingGuide: { seedingRate: { drilledLbsPerAcre: { min: 60, max: 120 } } }
    });
    expect(plantingSowMethod(drilledOnly, 'broadcast')).toBe('drilled');
  });

  it('the saved method changes the seed amount', () => {
    const m = spacingModel(both);
    expect(seedAmountFor(m, plantingSowMethod(m, 'drilled'), 43_560)).toMatchObject({
      method: 'drilled',
      lb: { min: 60, max: 120 }
    });
    expect(seedAmountFor(m, plantingSowMethod(m, 'broadcast'), 43_560)).toMatchObject({
      method: 'broadcast',
      lb: { min: 90, max: 160 }
    });
  });
});
