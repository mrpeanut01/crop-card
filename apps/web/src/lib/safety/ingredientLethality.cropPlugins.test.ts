import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CROP_FAMILIES, type CropFamily } from './cropFamilyLethality';
import { checkCropCompatibility } from './cropCompatibility';
import {
  INGREDIENT_KILL_ADDITIONS,
  ingredientKillsFamily,
  ingredientStopsCropPlugin
} from './ingredientLethality';
import { evaluateSpray } from './evaluate';
import { CHEMISTRY_CLASSES, type CropStage, type HerbicideProduct } from './types';

const ROOT = resolve(__dirname, '../../../../..');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const SOURCES = readJson(resolve(ROOT, 'apps/web/scripts/epa-reg-sources.json'))
  .ingredientLethality as Record<string, Record<string, unknown>>;

type CropPlugin = { pluginId: string; cropFamily: CropFamily; archetype?: string };
const CROPS: CropPlugin[] = readdirSync(resolve(ROOT, 'plugins/crops'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => readJson(resolve(ROOT, 'plugins/crops', f)));
const cropById = new Map(CROPS.map((c) => [c.pluginId, c]));

const HERBICIDES: HerbicideProduct[] = readdirSync(resolve(ROOT, 'plugins/herbicides'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => readJson(resolve(ROOT, 'plugins/herbicides', f)))
  .map((p) => ({
    pluginId: p.pluginId,
    displayName: p.displayName,
    activeIngredients: p.activeIngredients
  }));
const herbicide = (id: string) => HERBICIDES.find((h) => h.pluginId === id)!;
const stage = (id: string): CropStage => ({
  cropPluginId: id,
  cropFamily: cropById.get(id)!.cropFamily
});
const codes = (p: HerbicideProduct, c: CropStage) =>
  checkCropCompatibility([p], c).map((v) => v.code);

const chaparral = herbicide('chaparral-aminopyralid-metsulfuron');
const harmony = herbicide('harmony-sg-thifensulfuron');

const COOL_SEASON_HAY = CROPS.filter(
  (c) => c.cropFamily === 'forage-grass' && c.archetype === 'forage-cutting-cycle'
).map((c) => c.pluginId);
const HARMONY_FAMILIES: CropFamily[] = ['cereal-grain', 'cover-grass'];
const HARMONY_LABELLED = INGREDIENT_KILL_ADDITIONS.thifensulfuron.labelledOnlyIn!.cropPluginIds;

const listedIds = Object.values(INGREDIENT_KILL_ADDITIONS).flatMap((r) => [
  ...Object.keys(r.killsCropPlugins ?? {}),
  ...(r.labelledOnlyIn?.cropPluginIds ?? [])
]);
const idArb = fc.oneof(
  fc.constantFrom(...listedIds),
  fc.constantFrom(...CROPS.map((c) => c.pluginId)),
  fc.string({ maxLength: 16 })
);
const familyArb = fc.option(fc.constantFrom(...CROP_FAMILIES), { nil: undefined });
const ingredientNameArb = fc.oneof(
  fc.constantFrom(...Object.keys(INGREDIENT_KILL_ADDITIONS)),
  fc.constantFrom('Metsulfuron-methyl', 'Thifensulfuron methyl 50%', 'aminopyralid'),
  fc.string({ maxLength: 12 })
);
const productArb = fc
  .array(
    fc.record({ name: ingredientNameArb, chemistryClass: fc.constantFrom(...CHEMISTRY_CLASSES) }),
    { minLength: 1, maxLength: 3 }
  )
  .map((ais): HerbicideProduct => ({ pluginId: 'p', displayName: 'p', activeIngredients: ais }));
const cropArb = fc.record({
  cropPluginId: idArb,
  cropFamily: familyArb,
  traits: fc.constantFrom(undefined, ['x'])
});

/** The same product with ingredient names nobody lists, so no ingredient
 *  addition of any kind can apply: the class-only verdict. */
const anonymous = (p: HerbicideProduct): HerbicideProduct => ({
  ...p,
  activeIngredients: p.activeIngredients.map((a, i) => ({ ...a, name: `x${i}` }))
});
const pairs = (vs: ReturnType<typeof checkCropCompatibility>) =>
  vs.flatMap((v) =>
    ((v.detail?.crops ?? []) as Array<{ cropPluginId: string }>).map(
      (c) => `${String(v.detail?.chemistryClass)}|${c.cropPluginId}`
    )
  );

describe('ruling LF-1: ingredient stops by crop plugin', () => {
  it('property: a per-plugin stop never lifts a verdict the class or family rows give', () => {
    fc.assert(
      fc.property(productArb, cropArb, fc.array(cropArb, { maxLength: 2 }), (p, c, co) => {
        const strict = pairs(checkCropCompatibility([p], c, co));
        for (const pair of pairs(checkCropCompatibility([anonymous(p)], c, co))) {
          expect(strict).toContain(pair);
        }
      })
    );
  });

  it('property: every per-plugin stop shows up as a violation for that crop', () => {
    fc.assert(
      fc.property(productArb, cropArb, (p, c) => {
        const got = pairs(checkCropCompatibility([p], c));
        for (const ai of p.activeIngredients) {
          if (ingredientStopsCropPlugin(ai.name, c.cropPluginId, c.cropFamily)) {
            expect(got).toContain(`${ai.chemistryClass}|${c.cropPluginId}`);
          }
        }
      })
    );
  });

  it('property: a trait claim on the crop never lifts a per-plugin stop', () => {
    fc.assert(
      fc.property(productArb, cropArb, (p, c) => {
        const claimed: HerbicideProduct = {
          ...p,
          traitGatedSafeFor: [{ cropPluginId: c.cropPluginId, requiresTraits: ['x'] }]
        };
        const traited = { ...c, traits: ['x'] };
        const got = pairs(checkCropCompatibility([claimed], traited));
        for (const ai of p.activeIngredients) {
          if (ingredientStopsCropPlugin(ai.name, c.cropPluginId, c.cropFamily)) {
            expect(got).toContain(`${ai.chemistryClass}|${c.cropPluginId}`);
          }
        }
      })
    );
  });

  it('property: a crop id no row lists, outside a labelled-only family, gets no per-plugin stop', () => {
    fc.assert(
      fc.property(ingredientNameArb, fc.string({ maxLength: 16 }), familyArb, (n, id, f) => {
        fc.pre(!listedIds.includes(id));
        fc.pre(!f || !HARMONY_FAMILIES.includes(f));
        expect(ingredientStopsCropPlugin(n, id, f)).toBeNull();
      })
    );
  });

  it('property: Harmony SG is stopped on any cereal-grain or cover-grass id its label does not name', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.constantFrom(...HARMONY_FAMILIES),
        (id, f) => {
          fc.pre(!HARMONY_LABELLED.includes(id));
          expect(codes(harmony, { cropPluginId: id, cropFamily: f })).toEqual([
            'CROP_INCOMPATIBLE'
          ]);
        }
      )
    );
  });

  it('Chaparral is stopped on timothy-climax and orchard-grass-potomac', () => {
    for (const id of ['timothy-climax', 'orchard-grass-potomac']) {
      const vs = checkCropCompatibility([chaparral], stage(id));
      expect(
        vs.map((v) => v.code),
        id
      ).toEqual(['CROP_INCOMPATIBLE']);
      expect(vs[0].detail?.chemistryClass).toBe('sulfonylurea');
      expect(vs[0].detail?.crops).toEqual([
        { cropPluginId: id, cropFamily: 'forage-grass', isCoPlanted: false }
      ]);
    }
  });

  it('Chaparral is stopped on a hay grass even when the planting reports no family', () => {
    expect(codes(chaparral, { cropPluginId: 'timothy-climax' })).toEqual(['CROP_INCOMPATIBLE']);
  });

  it('Chaparral still passes on pasture with no planting, and on unlisted pasture grass', () => {
    expect(codes(chaparral, { cropPluginId: '__pre-plant__' })).toEqual([]);
    expect(codes(chaparral, { cropPluginId: 'pasture', cropFamily: 'forage-grass' })).toEqual([]);
    const out = evaluateSpray({
      occurredAt: 1_700_000_000_000,
      products: [chaparral],
      crop: { cropPluginId: '__pre-plant__' },
      sprayer: { id: 's1' },
      conditions: { windMph: 5, tempF: 70, rainForecastMmNext24h: 0 }
    });
    expect(out.violations.filter((v) => v.code === 'CROP_INCOMPATIBLE')).toEqual([]);
  });

  it('Chaparral is stopped on a hay grass planted beside a pasture grass', () => {
    const vs = checkCropCompatibility(
      [chaparral],
      { cropPluginId: 'pasture', cropFamily: 'forage-grass' },
      [stage('orchard-grass-potomac')]
    );
    expect(vs).toHaveLength(1);
    expect(vs[0].detail?.crops).toEqual([
      { cropPluginId: 'orchard-grass-potomac', cropFamily: 'forage-grass', isCoPlanted: true }
    ]);
  });

  it('Harmony SG passes on its labelled wheat, barley, oats and triticale plugins', () => {
    for (const id of HARMONY_LABELLED) {
      expect(codes(harmony, stage(id)), id).toEqual([]);
    }
    expect(codes(harmony, stage('corn-feed-dent-pioneer'))).toEqual([]);
  });

  it('Harmony SG is stopped on every other shipped cereal-grain and cover-grass plugin', () => {
    const others = CROPS.filter(
      (c) => HARMONY_FAMILIES.includes(c.cropFamily) && !HARMONY_LABELLED.includes(c.pluginId)
    );
    expect(others.length).toBeGreaterThan(0);
    for (const c of others) {
      expect(codes(harmony, stage(c.pluginId)), c.pluginId).toEqual(['CROP_INCOMPATIBLE']);
    }
    for (const id of [
      'rye-grain-aroostook',
      'sorghum-grain-pioneer',
      'broomcorn-mennonite',
      'proso-millet-cope',
      'teff-grain-tiffany',
      'spelt-oberkulmer',
      'einkorn-blackbeard',
      'emmer-vernal',
      'cereal-rye-cover',
      'millet-japanese-cover'
    ]) {
      expect(codes(harmony, stage(id)), id).toEqual(['CROP_INCOMPATIBLE']);
    }
  });

  it('no other shipped herbicide gains a per-plugin stop on any shipped crop', () => {
    const others = HERBICIDES.filter(
      (h) => !h.activeIngredients.some((ai) => /metsulfuron|thifensulfuron/i.test(ai.name))
    );
    expect(others.length).toBeGreaterThan(0);
    for (const h of others) {
      for (const c of CROPS) {
        for (const ai of h.activeIngredients) {
          expect(
            ingredientStopsCropPlugin(ai.name, c.pluginId, c.cropFamily),
            `${h.pluginId} on ${c.pluginId}`
          ).toBeNull();
        }
      }
    }
  });
});

describe('ruling LF-1 drift', () => {
  it('every shipped cool-season hay grass is on the metsulfuron list', () => {
    expect(COOL_SEASON_HAY.length).toBeGreaterThan(0);
    const listed = Object.keys(INGREDIENT_KILL_ADDITIONS.metsulfuron.killsCropPlugins ?? {});
    for (const id of COOL_SEASON_HAY) expect(listed, id).toContain(id);
  });

  it('every listed crop plugin id is a shipped plugin of the family the row gives', () => {
    for (const [k, row] of Object.entries(INGREDIENT_KILL_ADDITIONS)) {
      for (const [id, f] of Object.entries(row.killsCropPlugins ?? {})) {
        expect(cropById.get(id)?.cropFamily, `${k}: ${id}`).toBe(f);
      }
      for (const id of row.labelledOnlyIn?.cropPluginIds ?? []) {
        expect(row.labelledOnlyIn!.families, `${k}: ${id}`).toContain(cropById.get(id)?.cropFamily);
      }
    }
  });

  it('every shipped cereal-grain and cover-grass plugin is classified for thifensulfuron', () => {
    const stopped = Object.keys(INGREDIENT_KILL_ADDITIONS.thifensulfuron.killsCropPlugins ?? {});
    for (const c of CROPS.filter((x) => HARMONY_FAMILIES.includes(x.cropFamily))) {
      const allowed = HARMONY_LABELLED.includes(c.pluginId);
      const stop = stopped.includes(c.pluginId);
      expect(allowed !== stop, `${c.pluginId} must be labelled or stopped, not both`).toBe(true);
    }
  });

  it('a stopped plugin is never also on the labelled list', () => {
    for (const row of Object.values(INGREDIENT_KILL_ADDITIONS)) {
      for (const id of Object.keys(row.killsCropPlugins ?? {})) {
        expect(row.labelledOnlyIn?.cropPluginIds ?? []).not.toContain(id);
      }
    }
  });

  it('the only shipped plugin carrying metsulfuron is Chaparral, so no wheat-labelled metsulfuron product is stopped', () => {
    const carrying = HERBICIDES.filter((h) =>
      h.activeIngredients.some((ai) => /metsulfuron/i.test(ai.name))
    ).map((h) => h.pluginId);
    expect(carrying).toEqual(['chaparral-aminopyralid-metsulfuron']);
    for (const id of ['wheat-soft-red-winter', 'corn-feed-dent-pioneer']) {
      for (const ai of chaparral.activeIngredients) {
        if (/metsulfuron/i.test(ai.name))
          expect(ingredientKillsFamily(ai.name, stage(id).cropFamily!)).toBe(true);
      }
    }
  });

  it('the sources entry matches the kernel row and quotes the label for every per-plugin rule', () => {
    type Src = {
      pluginId: string;
      sourceUrl: string;
      docDate: string;
      page: number;
      quote: string;
    };
    for (const [k, row] of Object.entries(INGREDIENT_KILL_ADDITIONS)) {
      const e = SOURCES[k];
      expect(e?.killsCropPlugins ?? {}, k).toEqual(row.killsCropPlugins ?? {});
      expect(e?.labelledOnlyIn, k).toEqual(row.labelledOnlyIn);
      const srcs = (e?.cropPluginSources ?? []) as Src[];
      if (row.killsCropPlugins || row.labelledOnlyIn) expect(srcs.length, k).toBeGreaterThan(0);
      for (const s of srcs) {
        expect(s.sourceUrl).toMatch(/^https:\/\/www3\.epa\.gov\/pesticides\/chem_search\/ppls\//);
        expect(s.docDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(s.page).toBeGreaterThan(0);
        expect(s.quote.trim().length).toBeGreaterThan(20);
        expect(
          HERBICIDES.some((h) => h.pluginId === s.pluginId),
          s.pluginId
        ).toBe(true);
      }
    }
    const chaparralQuotes = (SOURCES.metsulfuron.cropPluginSources as Src[]).map((s) => s.quote);
    expect(chaparralQuotes.join(' ')).toContain(
      'Do not use on Timothy hay or other cool-season grasses grown for hay.'
    );
  });
});
