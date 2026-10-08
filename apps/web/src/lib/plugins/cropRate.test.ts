import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeTankMixDilutions, productsWithoutRate } from '$lib/dilution/calculator';
import { herbicidePluginSchema, type HerbicidePlugin } from '$lib/plugins/schemas';
import {
  cropRateRows,
  cropRateText,
  labelRateForCrops,
  stageLimitsForCrops,
  withCropRate
} from './cropRate';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const banvel = herbicidePluginSchema.parse(
  JSON.parse(readFileSync(path.join(REPO_ROOT, 'plugins/herbicides/banvel.json'), 'utf8'))
) as HerbicidePlugin;

const WHEAT = 'wheat-soft-red-winter';
const BARLEY = 'barley-grain-thoroughbred';
const CORN = 'corn-feed-dent-pioneer';

describe('herbicide label rates by crop (#737)', () => {
  it('Banvel has no default rate, only per-crop label rates', () => {
    expect(banvel.ratePerAcre).toBeUndefined();
    expect(labelRateForCrops(banvel, [WHEAT])).toMatchObject({
      amount: 2,
      maxAmount: 4,
      unit: 'fl-oz'
    });
    expect(labelRateForCrops(banvel, [CORN])).toMatchObject({
      amount: 0.5,
      maxAmount: 1,
      unit: 'pt'
    });
  });

  it('wheat and barley share a rate, so a mixed small-grain block gets it', () => {
    expect(labelRateForCrops(banvel, [WHEAT, BARLEY])?.amount).toBe(2);
  });

  it('a block with a crop the label table does not list keeps "Check the label"', () => {
    expect(labelRateForCrops(banvel, ['soybean-generic'])).toBeNull();
    expect(labelRateForCrops(banvel, [WHEAT, 'soybean-generic'])).toBeNull();
    expect(labelRateForCrops(banvel, [])).toBeNull();
    expect(withCropRate(banvel, ['soybean-generic'])).toBe(banvel);
    expect(productsWithoutRate([withCropRate(banvel, ['soybean-generic'])])).toEqual(['banvel']);
  });

  it('crops whose label rates differ get no crop rate', () => {
    expect(labelRateForCrops(banvel, [WHEAT, CORN])).toBeNull();
  });

  it('a matched crop rate goes into the mix as a label rate', () => {
    const rated = withCropRate(banvel, [CORN]);
    expect(rated.ratePerAcre).toEqual({ amount: 0.5, unit: 'pt' });
    expect(rated.rateProvenance).toBe('label');
    const [line] = computeTankMixDilutions([rated], 30, 15);
    expect(line.rateProvenance).toBe('plugin');
    expect(line.productAmount).toBeCloseTo(1); // 0.5 pt/acre x 2 acres
    expect(line.unit).toBe('pt');
    expect(productsWithoutRate([rated])).toEqual([]);
  });

  it('never changes a product with no crop table', () => {
    const plain = { ...banvel, ratePerAcreByCrop: undefined, stageLimitByCrop: undefined };
    fc.assert(
      fc.property(fc.array(fc.constantFrom(WHEAT, BARLEY, CORN, 'x')), (crops) => {
        expect(withCropRate(plain, crops)).toBe(plain);
      })
    );
  });

  it('a crop rate is applied only when every sprayed crop has the same row', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(WHEAT, BARLEY, CORN, 'other'), { minLength: 1 }),
        (crops) => {
          const r = labelRateForCrops(banvel, crops);
          const set = new Set(crops);
          if (set.has('other') || (set.has(CORN) && set.size > 1)) expect(r).toBeNull();
          else expect(r).not.toBeNull();
        }
      )
    );
  });

  it('stage limits are listed for the sprayed crops only', () => {
    expect(stageLimitsForCrops(banvel, [WHEAT]).map((s) => s.limit)).toEqual([
      'DICAMBA DMA 4# AG herbicide MUST BE APPLIED TO FALL SEEDED WHEAT PRIOR TO THE JOINTING STAGE.'
    ]);
    expect(stageLimitsForCrops(banvel, [CORN])).toHaveLength(3);
    expect(stageLimitsForCrops(banvel, ['soybean-generic'])).toEqual([]);
  });

  it('builds detail rows and range text', () => {
    const rows = cropRateRows(banvel, (id) => id.toUpperCase());
    expect(rows.map((r) => r.cropPluginId)).toEqual([WHEAT, BARLEY, CORN]);
    expect(rows[0].crop).toBe(WHEAT.toUpperCase());
    expect(cropRateText(rows[0].rate!)).toBe('2 to 4 fl oz/acre');
    expect(cropRateText(rows[2].rate!)).toBe('0.5 to 1 pt/acre');
    expect(cropRateText({ amount: 1, unit: 'pt' })).toBe('1 pt/acre');
  });

  it('the schema refuses a maximum below the amount', () => {
    const bad = {
      ...banvel,
      ratePerAcreByCrop: [{ cropPluginId: WHEAT, amount: 4, maxAmount: 2, unit: 'fl-oz' }]
    };
    expect(herbicidePluginSchema.safeParse(bad).success).toBe(false);
  });
});
