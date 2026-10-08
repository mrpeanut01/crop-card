import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { checkCropCompatibility } from '$lib/safety/cropCompatibility';
import { CROP_FAMILIES } from '$lib/safety/cropFamilyLethality';
import { CHEMISTRY_CLASSES } from '$lib/safety/types';
import { herbicideHarm, type HarmCrop } from './herbicideHarm';

const chaparral = {
  chemistryClasses: ['synthetic-auxin', 'sulfonylurea'],
  activeNames: ['aminopyralid', 'metsulfuron-methyl']
};
const harmony = { chemistryClasses: ['sulfonylurea'], activeNames: ['Thifensulfuron methyl'] };
const timothy: HarmCrop = {
  pluginId: 'timothy-climax',
  displayName: 'Timothy — Climax (cool-season grass hay)',
  family: 'forage-grass'
};
const sudangrass: HarmCrop = {
  pluginId: 'sudangrass-piper',
  displayName: 'Sudangrass Piper (forage)',
  family: 'forage-grass'
};

describe('herbicideHarm (ruling LF-1)', () => {
  it('names the hay grass Chaparral is stopped on, and nothing on warm-season forage', () => {
    expect(herbicideHarm(chaparral, [timothy])).toEqual({
      families: ['forage-grass'],
      ruledOut: [timothy.displayName]
    });
    expect(herbicideHarm(chaparral, [sudangrass])).toEqual({ families: [], ruledOut: [] });
  });

  it('names the cereals Harmony SG is stopped on and passes the labelled ones', () => {
    const rye: HarmCrop = {
      pluginId: 'rye-grain-aroostook',
      displayName: 'Rye Aroostook (grain)',
      family: 'cereal-grain'
    };
    const wheat: HarmCrop = {
      pluginId: 'wheat-soft-red-winter',
      displayName: 'Wheat',
      family: 'cereal-grain'
    };
    expect(herbicideHarm(harmony, [wheat])).toEqual({ families: [], ruledOut: [] });
    expect(herbicideHarm(harmony, [wheat, rye])).toEqual({
      families: ['cereal-grain'],
      ruledOut: [rye.displayName]
    });
  });

  it('property: the hint flags a herbicide exactly when the kernel would stop it', () => {
    const cropArb = fc.record({
      pluginId: fc.constantFrom(
        'timothy-climax',
        'orchard-grass-potomac',
        'rye-grain-aroostook',
        'wheat-soft-red-winter',
        'oats-cover-spring',
        'x'
      ),
      displayName: fc.constant('n'),
      family: fc.option(fc.constantFrom(...CROP_FAMILIES), { nil: undefined })
    });
    const nameArb = fc.constantFrom(
      'Metsulfuron methyl',
      'Thifensulfuron methyl',
      'Nicosulfuron',
      'glyphosate',
      'other'
    );
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ name: nameArb, chemistryClass: fc.constantFrom(...CHEMISTRY_CLASSES) }),
          { minLength: 1, maxLength: 3 }
        ),
        fc.array(cropArb, { minLength: 1, maxLength: 3 }),
        (ais, crops) => {
          const harm = herbicideHarm(
            {
              chemistryClasses: ais.map((a) => a.chemistryClass),
              activeNames: ais.map((a) => a.name)
            },
            crops
          );
          const product = { pluginId: 'p', displayName: 'p', activeIngredients: ais };
          const stopped = crops.some(
            (c) =>
              checkCropCompatibility([product], {
                cropPluginId: c.pluginId,
                cropFamily: c.family
              }).length > 0
          );
          expect(harm.families.length > 0).toBe(stopped);
        }
      )
    );
  });
});
