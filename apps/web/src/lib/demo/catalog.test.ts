// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SEED_EQUIPMENT_TEMPLATES } from '$lib/server/equipmentTemplates';
import { validateAreaDetails } from '$lib/farm/areaKinds';
import {
  DEMO_AREAS,
  DEMO_BEDS,
  DEMO_CROPS,
  DEMO_EQUIPMENT,
  DEMO_PERENNIALS,
  DEMO_PRODUCTS,
  DEMO_SEEDS
} from './catalog';

const PLUGINS = new URL('../../../../../plugins/', import.meta.url);

function plugin(dir: string, id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`${dir}/${id}.json`, PLUGINS), 'utf8'));
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('demo catalog matches the shipped plugins', () => {
  it('products', () => {
    for (const p of Object.values(DEMO_PRODUCTS)) {
      const raw = plugin(p.dir, p.pluginId) as Json;
      expect(raw.pluginId).toBe(p.pluginId);
      expect(raw.type).toBe(p.kind);
      expect(raw.displayName).toBe(p.displayName);
      expect(raw.defaultUnit).toBe(p.unit);
      if (p.rate) expect(raw.ratePerAcre).toEqual(p.rate);
      if (p.kind === 'fertilizer') {
        expect(raw.analysis).toEqual(p.npk);
        continue;
      }
      const codes = (raw.activeIngredients as Json[]).map(
        (a) => a.chemistryClass ?? a.iracGroup ?? a.fracCode
      );
      expect(codes).toEqual(p.codes);
      expect(raw.reEntryIntervalHours).toBe(p.reiHours);
      expect(raw.preHarvestIntervalDays).toBe(p.phiDays);
    }
  });

  it('crops: days to maturity, and every spray is labelled for its crop', () => {
    const sprayed: Array<[string, string]> = [];
    for (const c of DEMO_CROPS) {
      const raw = plugin('crops', c.cropPluginId) as Json;
      expect(raw.type).toBe('crop');
      expect([raw.daysToMaturity.min, raw.daysToMaturity.max]).toEqual(c.dtm);
      for (const op of c.ops) {
        if (op.kind === 'spray' || op.kind === 'fertilize')
          expect(DEMO_PRODUCTS[op.product]).toBeDefined();
        if (op.kind === 'spray') sprayed.push([op.product, c.cropPluginId]);
      }
    }
    for (const p of DEMO_PERENNIALS) {
      const raw = plugin('crops', p.cropPluginId) as Json;
      if (raw.daysToMaturity)
        expect([raw.daysToMaturity.min, raw.daysToMaturity.max]).toEqual(p.dtm);
      for (const op of p.ops) sprayed.push([op.product, p.cropPluginId]);
    }
    for (const [productId, cropId] of sprayed) {
      const product = DEMO_PRODUCTS[productId];
      const claims = (plugin(product.dir, productId) as Json).labelClaims ?? {};
      const crop = plugin('crops', cropId) as Json;
      if (claims.safeForCropPluginIds) expect(claims.safeForCropPluginIds).toContain(cropId);
      if (claims.safeForCropFamilies) expect(claims.safeForCropFamilies).toContain(crop.cropFamily);
      if (product.kind === 'herbicide') expect(claims.safeForCropPluginIds).toContain(cropId);
    }
  });

  it('seed lots point at real crops', () => {
    for (const s of DEMO_SEEDS) expect((plugin('crops', s.cropPluginId) as Json).type).toBe('crop');
  });

  it('gear comes from the starter library', () => {
    for (const e of DEMO_EQUIPMENT) {
      expect(SEED_EQUIPMENT_TEMPLATES.some((t) => t.templateId === e.templateId)).toBe(true);
    }
  });

  it('Area details validate and beds sit inside their Areas', () => {
    for (const a of DEMO_AREAS) {
      expect(validateAreaDetails(a.kind, a.details ?? {}).ok).toBe(true);
    }
    for (const b of DEMO_BEDS) {
      const area = DEMO_AREAS.find((a) => a.key === b.area)!;
      if (b.xFt !== undefined && b.yFt !== undefined) {
        expect(b.xFt + b.widthFt).toBeLessThanOrEqual(area.widthFt);
        expect(b.yFt + b.lengthFt).toBeLessThanOrEqual(area.lengthFt);
      }
    }
  });

  it('plantings fit their beds', () => {
    for (const c of DEMO_CROPS) {
      if (!c.footprint || typeof c.bed === 'function') continue;
      const bed = DEMO_BEDS.find((b) => b.key === c.bed)!;
      expect(c.footprint.x_in + c.footprint.w_in).toBeLessThanOrEqual(bed.widthFt * 12);
      expect(c.footprint.y_in + c.footprint.l_in).toBeLessThanOrEqual(bed.lengthFt * 12);
    }
  });

  it('species and the animal medicine exist', () => {
    for (const id of ['chicken', 'goat', 'dog']) {
      expect((plugin('species', id) as Json).type).toBe('species');
    }
    expect((plugin('animal-health', 'safe-guard-suspension') as Json).pluginId).toBe(
      'safe-guard-suspension'
    );
  });
});
