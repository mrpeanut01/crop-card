import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CROP_FAMILIES, killsFamily, type CropFamily } from './cropFamilyLethality';
import { checkCropCompatibility } from './cropCompatibility';
import {
  INGREDIENT_KILL_ADDITIONS,
  ingredientKeysOf,
  ingredientKillsFamily
} from './ingredientLethality';
import { CHEMISTRY_CLASSES, type HerbicideProduct } from './types';

const ROOT = resolve(__dirname, '../../../../..');
const pluginJson = (rel: string) => JSON.parse(readFileSync(resolve(ROOT, 'plugins', rel), 'utf8'));
const SOURCES = JSON.parse(
  readFileSync(resolve(ROOT, 'apps/web/scripts/epa-reg-sources.json'), 'utf8')
).ingredientLethality as Record<string, unknown>;

const herbicide = (rel: string): HerbicideProduct => {
  const p = pluginJson(`herbicides/${rel}.json`);
  return {
    pluginId: p.pluginId,
    displayName: p.displayName,
    activeIngredients: p.activeIngredients
  };
};
const crop = (cropPluginId: string) => ({
  cropPluginId,
  cropFamily: pluginJson(`crops/${cropPluginId}.json`).cropFamily as CropFamily
});
const codes = (p: HerbicideProduct, c: ReturnType<typeof crop>) =>
  checkCropCompatibility([p], c).map((v) => v.code);

const classArb = fc.constantFrom(...CHEMISTRY_CLASSES);
const familyArb = fc.constantFrom(...CROP_FAMILIES);
const keyArb = fc.constantFrom(...Object.keys(INGREDIENT_KILL_ADDITIONS));
const nameArb = fc.oneof(
  keyArb,
  keyArb.map((k) => `${k.toUpperCase()}-methyl`),
  keyArb.map((k) => `  ${k} 75% `),
  fc.string({ maxLength: 20 })
);
const ingredientArb = fc.record({ name: nameArb, chemistryClass: classArb });

describe('per-ingredient lethality (#768)', () => {
  it('property: an ingredient never makes a verdict more lenient than its class', () => {
    fc.assert(
      fc.property(fc.array(ingredientArb, { minLength: 1, maxLength: 4 }), familyArb, (ais, f) => {
        const named: HerbicideProduct = {
          pluginId: 'p',
          displayName: 'p',
          activeIngredients: ais
        };
        const anonymous: HerbicideProduct = {
          ...named,
          activeIngredients: ais.map((a, i) => ({ ...a, name: `x${i}` }))
        };
        const c = { cropPluginId: 'c', cropFamily: f };
        const byClass = checkCropCompatibility([anonymous], c).map((v) => v.detail?.chemistryClass);
        const byName = checkCropCompatibility([named], c).map((v) => v.detail?.chemistryClass);
        for (const cls of byClass) expect(byName).toContain(cls);
        for (const a of ais) {
          if (killsFamily(a.chemistryClass, f) || ingredientKillsFamily(a.name, f)) {
            expect(byName).toContain(a.chemistryClass);
          }
        }
      })
    );
  });

  it('property: name matching ignores case, spacing, punctuation and ester suffixes', () => {
    fc.assert(
      fc.property(keyArb, familyArb, (k, f) => {
        const base = INGREDIENT_KILL_ADDITIONS[k].killsFamilies.includes(f);
        for (const v of [k, k.toUpperCase(), ` ${k}-methyl `, `${k}-ethyl 25%`]) {
          expect(ingredientKeysOf(v)).toContain(k);
          expect(ingredientKillsFamily(v, f)).toBe(base);
        }
      })
    );
  });

  it('property: an unknown ingredient name adds nothing', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), familyArb, (name, f) => {
        fc.pre(ingredientKeysOf(name).length === 0);
        expect(ingredientKillsFamily(name, f)).toBe(false);
      })
    );
  });

  it('Accent Q (nicosulfuron) is blocked on grass hay, pasture grass, wheat and cereal rye cover', () => {
    const accent = herbicide('accent-q-nicosulfuron');
    for (const id of [
      'timothy-climax',
      'orchard-grass-potomac',
      'wheat-soft-red-winter',
      'barley-grain-thoroughbred',
      'cereal-rye-cover'
    ]) {
      expect(codes(accent, crop(id)), id).toEqual(['CROP_INCOMPATIBLE']);
    }
    expect(codes(accent, crop('corn-feed-dent-pioneer'))).toEqual([]);
  });

  it('property: Accent Q over any grass-hay or cereal planting is refused', () => {
    const accent = herbicide('accent-q-nicosulfuron');
    fc.assert(
      fc.property(
        fc.constantFrom<CropFamily>('forage-grass', 'cereal-grain', 'cover-grass'),
        fc.string({ minLength: 1, maxLength: 12 }),
        (f, id) => {
          expect(
            checkCropCompatibility([accent], { cropPluginId: id, cropFamily: f })
          ).toHaveLength(1);
        }
      )
    );
  });

  it('Chaparral (metsulfuron) still passes on pasture and warm-season forage grass', () => {
    const chaparral = herbicide('chaparral-aminopyralid-metsulfuron');
    for (const id of ['sudangrass-piper', 'bmr-sorghum-sudan']) {
      expect(codes(chaparral, crop(id)), id).toEqual([]);
    }
    const hay = Object.keys(INGREDIENT_KILL_ADDITIONS.metsulfuron.killsCropPlugins ?? {});
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (id) => {
        fc.pre(!hay.includes(id));
        expect(
          checkCropCompatibility([chaparral], { cropPluginId: id, cropFamily: 'forage-grass' })
        ).toEqual([]);
      })
    );
  });

  it('Chaparral is refused on wheat and corn, which its label says may only follow a year later', () => {
    const chaparral = herbicide('chaparral-aminopyralid-metsulfuron');
    expect(codes(chaparral, crop('wheat-soft-red-winter'))).toEqual(['CROP_INCOMPATIBLE']);
    expect(codes(chaparral, crop('corn-feed-dent-pioneer'))).toEqual(['CROP_INCOMPATIBLE']);
  });

  it('labelled grass uses keep working: Harmony SG on wheat and corn, Capreno and Permit on corn, Permit on pasture', () => {
    expect(codes(herbicide('harmony-sg-thifensulfuron'), crop('wheat-soft-red-winter'))).toEqual(
      []
    );
    expect(codes(herbicide('harmony-sg-thifensulfuron'), crop('corn-feed-dent-pioneer'))).toEqual(
      []
    );
    expect(
      codes(herbicide('capreno-thiencarbazone-tembotrione'), crop('corn-feed-dent-pioneer'))
    ).toEqual([]);
    expect(codes(herbicide('permit'), crop('corn-feed-dent-pioneer'))).toEqual([]);
    expect(codes(herbicide('permit'), crop('orchard-grass-potomac'))).toEqual([]);
  });

  it('Classic (chlorimuron) is refused on corn, wheat and grass hay; Harmony SG on grass hay', () => {
    for (const id of ['corn-feed-dent-pioneer', 'wheat-soft-red-winter', 'timothy-climax']) {
      expect(codes(herbicide('classic-chlorimuron'), crop(id)), id).toEqual(['CROP_INCOMPATIBLE']);
    }
    expect(codes(herbicide('harmony-sg-thifensulfuron'), crop('timothy-climax'))).toEqual([
      'CROP_INCOMPATIBLE'
    ]);
  });

  it('every shipped sulfonylurea ingredient is either covered by a row or recorded as labelled on the grass families', () => {
    const files = [
      'accent-q-nicosulfuron',
      'capreno-thiencarbazone-tembotrione',
      'chaparral-aminopyralid-metsulfuron',
      'classic-chlorimuron',
      'harmony-sg-thifensulfuron',
      'permit',
      'sandea',
      'stadia'
    ];
    for (const f of files) {
      for (const ai of herbicide(f).activeIngredients) {
        if (ai.chemistryClass !== 'sulfonylurea') continue;
        const n = ai.name.toLowerCase().replace(/[^a-z]/g, '');
        const recorded = Object.keys(SOURCES).filter((k) => !k.startsWith('$') && n.includes(k));
        expect(recorded, `${f}: ${ai.name}`).toHaveLength(1);
      }
    }
  });
});

describe('per-ingredient lethality sources (#768)', () => {
  type Src = { pluginId: string; sourceUrl: string; docDate: string; page: number; quote: string };
  type Entry = { killsFamilies: string[]; sources: Src[]; labelledFamilies?: string[] };

  it('every ingredient row matches its sources entry and rests on a quoted label', () => {
    for (const [k, row] of Object.entries(INGREDIENT_KILL_ADDITIONS)) {
      const e = SOURCES[k] as Entry | undefined;
      expect(e, k).toBeDefined();
      expect([...e!.killsFamilies].sort(), k).toEqual([...row.killsFamilies].sort());
      expect(e!.sources.length, k).toBeGreaterThan(0);
      for (const s of e!.sources) {
        expect(s.sourceUrl).toMatch(/^https:\/\/www3\.epa\.gov\/pesticides\/chem_search\/ppls\//);
        expect(s.docDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(s.page).toBeGreaterThan(0);
        expect(s.quote.trim().length).toBeGreaterThan(20);
        expect(() => pluginJson(`herbicides/${s.pluginId}.json`)).not.toThrow();
      }
    }
  });

  it('no row adds a family that a label carrying the ingredient is registered on', () => {
    for (const [k, row] of Object.entries(INGREDIENT_KILL_ADDITIONS)) {
      const labelled = (SOURCES[k] as Entry).labelledFamilies ?? [];
      for (const f of row.killsFamilies) expect(labelled, `${k}: ${f}`).not.toContain(f);
    }
  });

  it('every sources entry with families has a kernel row', () => {
    for (const [k, e] of Object.entries(SOURCES)) {
      if (k.startsWith('$')) continue;
      if ((e as Entry).killsFamilies.length > 0)
        expect(INGREDIENT_KILL_ADDITIONS[k], k).toBeDefined();
    }
  });
});
