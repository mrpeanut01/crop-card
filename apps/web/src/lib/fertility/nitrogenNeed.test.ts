import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CropPlugin } from '$lib/plugins/schemas';
import { inBudgetYear, nitrogenNeedRows, nitrogenNeedTotal } from './nitrogenNeed';

const PLUGIN_DIR = path.resolve(__dirname, '../../../../../plugins/crops');
const plugin = (id: string) =>
  JSON.parse(readFileSync(path.join(PLUGIN_DIR, `${id}.json`), 'utf8')) as CropPlugin;
const lookup = (id: string) => {
  try {
    const p = plugin(id);
    return { nitrogenNeedLbPerAcre: p.nitrogenNeedLbPerAcre, name: p.displayName };
  } catch {
    return null;
  }
};

describe('#739 crop N need', () => {
  it('sums the sourced parts', () => {
    expect(nitrogenNeedTotal(plugin('wheat-soft-red-winter').nitrogenNeedLbPerAcre!)).toEqual({
      min: 60,
      max: 100
    });
    expect(nitrogenNeedTotal(plugin('corn').nitrogenNeedLbPerAcre!)).toEqual({
      min: 125,
      max: 150
    });
    expect(
      nitrogenNeedTotal(plugin('soybean-asgrow-roundup-ready-2-xtend').nitrogenNeedLbPerAcre!)
    ).toEqual({ min: 0, max: 0 });
  });

  it('never gives a total below the largest part or min above max', () => {
    const part = fc
      .tuple(fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 400 }))
      .map(([a, b]) => ({ min: Math.min(a, b), max: Math.max(a, b) }));
    fc.assert(
      fc.property(fc.array(part, { minLength: 1, maxLength: 3 }), (parts) => {
        const total = nitrogenNeedTotal(parts);
        expect(total.min).toBeLessThanOrEqual(total.max);
        for (const p of parts) expect(total.max).toBeGreaterThanOrEqual(p.max);
      })
    );
  });

  it('counts a fall-sown grain in the next year and skips other years', () => {
    expect(inBudgetYear(new Date(2025, 9, 15).getTime(), 2026)).toBe(true);
    expect(inBudgetYear(new Date(2026, 4, 1).getTime(), 2026)).toBe(true);
    expect(inBudgetYear(new Date(2025, 4, 1).getTime(), 2026)).toBe(false);
    expect(inBudgetYear(new Date(2027, 0, 2).getTime(), 2026)).toBe(false);
    expect(inBudgetYear(null, 2026)).toBe(true);
  });

  it('lists one row per sourced crop on the block and skips crops with none', () => {
    const rows = nitrogenNeedRows(
      [
        { cropPluginId: 'wheat-soft-red-winter', plantingDate: new Date(2025, 9, 20).getTime() },
        { cropPluginId: 'wheat-soft-red-winter', plantingDate: new Date(2025, 9, 25).getTime() },
        { cropPluginId: 'tomato-black-krim', plantingDate: new Date(2026, 4, 1).getTime() },
        { cropPluginId: 'corn', plantingDate: new Date(2024, 4, 1).getTime() },
        { cropPluginId: 'missing-plugin', plantingDate: null }
      ],
      2026,
      lookup
    );
    expect(rows).toEqual([
      {
        cropPluginId: 'wheat-soft-red-winter',
        cropName: plugin('wheat-soft-red-winter').displayName,
        minLbPerAcre: 60,
        maxLbPerAcre: 100
      }
    ]);
  });
});
