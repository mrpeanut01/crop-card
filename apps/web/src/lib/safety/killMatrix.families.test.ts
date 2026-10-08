import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  CHEMISTRY_KILL_MATRIX,
  CROP_FAMILIES,
  hracGroupOf,
  killsFamily,
  type CropFamily
} from './cropFamilyLethality';
import { checkCropCompatibility } from './cropCompatibility';
import { CHEMISTRY_CLASSES, type ChemistryClass, type HerbicideProduct } from './types';
import { en, type MessageKey } from '$lib/i18n/catalogs/en';
import { es } from '$lib/i18n/catalogs/es';

const PLUGINS = resolve(__dirname, '../../../../../plugins');
const pluginJson = (rel: string) => JSON.parse(readFileSync(resolve(PLUGINS, rel), 'utf8'));

const product = (cls: ChemistryClass): HerbicideProduct => ({
  pluginId: `p-${cls}`,
  displayName: cls,
  activeIngredients: [{ name: cls, chemistryClass: cls }]
});
const classArb = fc.constantFrom(...CHEMISTRY_CLASSES);
const familyArb = fc.constantFrom(...CROP_FAMILIES);

describe('kill matrix — unclassified chemistry (#654)', () => {
  it('kills every crop family and carries no HRAC group', () => {
    fc.assert(
      fc.property(familyArb, (f) => {
        expect(killsFamily('unclassified', f)).toBe(true);
      })
    );
    expect(hracGroupOf('unclassified')).toBeNull();
  });

  it('every other class carries an HRAC group', () => {
    for (const cls of CHEMISTRY_CLASSES) {
      if (cls === 'unclassified') continue;
      expect(typeof CHEMISTRY_KILL_MATRIX[cls].hracGroup).toBe('number');
    }
  });

  it('corn gluten meal stays unclassified, so it stops at least everything its old stand-in class stopped', () => {
    const p = pluginJson('herbicides/corn-gluten-meal-pre.json');
    const classes = p.activeIngredients.map((a: { chemistryClass: string }) => a.chemistryClass);
    expect(classes).toEqual(['unclassified']);
    for (const f of CROP_FAMILIES) {
      if (killsFamily('microtubule-inhibitor', f))
        expect(killsFamily('unclassified', f)).toBe(true);
    }
  });
});

describe('kill matrix — thiocarbamate from the Eptam label (#654)', () => {
  it('is HRAC 15 and spares only legume forage, the family the Eptam label covers', () => {
    expect(hracGroupOf('thiocarbamate')).toBe(15);
    expect(killsFamily('thiocarbamate', 'forage')).toBe(false);
    expect(CROP_FAMILIES.filter((f) => !killsFamily('thiocarbamate', f))).toEqual(['forage']);
  });

  it('property: every family other than legume forage is lethal', () => {
    fc.assert(
      fc.property(familyArb, (f) => {
        expect(killsFamily('thiocarbamate', f)).toBe(f !== 'forage');
      })
    );
  });

  it('property: thiocarbamate stops everything its old stand-in class (pyroxasulfone) stopped except forage', () => {
    fc.assert(
      fc.property(familyArb, (f) => {
        if (killsFamily('vlcfa-pyroxasulfone', f))
          expect(killsFamily('thiocarbamate', f)).toBe(true);
      })
    );
  });

  it('Eptam uses thiocarbamate; it is refused on beans, potatoes, wheat and grass hay and allowed on alfalfa and red clover', () => {
    const p = pluginJson('herbicides/eptam-eptc.json');
    const classes = p.activeIngredients.map((a: { chemistryClass: string }) => a.chemistryClass);
    expect(classes).toEqual(['thiocarbamate']);
    const eptam: HerbicideProduct = {
      pluginId: p.pluginId,
      displayName: p.displayName,
      activeIngredients: p.activeIngredients
    };
    for (const [id, fam] of [
      ['soybean-asgrow-roundup-ready-2-xtend', 'legume'],
      ['potato-kennebec', 'solanaceae'],
      ['orchard-grass-potomac', 'forage-grass'],
      ['crimson-clover-cover', 'cover-legume']
    ] as const) {
      expect(
        checkCropCompatibility([eptam], { cropPluginId: id, cropFamily: fam }).map((v) => v.code),
        id
      ).toEqual(['CROP_INCOMPATIBLE']);
    }
    for (const id of ['alfalfa-vernema', 'alfalfa-hi-gest-660', 'clover-red-mammoth']) {
      expect(checkCropCompatibility([eptam], { cropPluginId: id, cropFamily: 'forage' })).toEqual(
        []
      );
    }
  });

  it('property: a mix with Eptam over any non-forage planting is refused', () => {
    fc.assert(
      fc.property(classArb, familyArb, (other, fam) => {
        const mix: HerbicideProduct = {
          pluginId: 'mix',
          displayName: 'mix',
          activeIngredients: [
            { name: 'EPTC', chemistryClass: 'thiocarbamate' },
            { name: other, chemistryClass: other }
          ]
        };
        const v = checkCropCompatibility([mix], { cropPluginId: 'c', cropFamily: fam });
        if (fam !== 'forage') expect(v.length).toBeGreaterThan(0);
      })
    );
  });
});

describe('chemistry class names (#654)', () => {
  it('every class has an English and Spanish name for the /spray picker', () => {
    for (const cls of CHEMISTRY_CLASSES) {
      const key = `sprayui.chemclass.${cls}` as MessageKey;
      expect(en[key], cls).toBeTruthy();
      expect(es[key], cls).toBeTruthy();
    }
  });
});

describe('kill matrix — grass hay and pasture (#726)', () => {
  it('ACCase grass killers stop grass forage but not legume forage', () => {
    expect(killsFamily('accase-inhibitor', 'forage-grass')).toBe(true);
    expect(killsFamily('accase-inhibitor', 'forage')).toBe(false);
  });

  it('property: grass forage is stopped by every class that stops cereals, grass cover or forage', () => {
    fc.assert(
      fc.property(classArb, (cls) => {
        const grassy =
          killsFamily(cls, 'cereal-grain') ||
          killsFamily(cls, 'cover-grass') ||
          killsFamily(cls, 'forage');
        if (grassy) expect(killsFamily(cls, 'forage-grass')).toBe(true);
      })
    );
  });

  it('clethodim on an orchardgrass block is refused; on alfalfa it is not', () => {
    const grass = checkCropCompatibility([product('accase-inhibitor')], {
      cropPluginId: 'orchard-grass-potomac',
      cropFamily: 'forage-grass'
    });
    expect(grass.map((v) => v.code)).toEqual(['CROP_INCOMPATIBLE']);
    const alfalfa = checkCropCompatibility([product('accase-inhibitor')], {
      cropPluginId: 'alfalfa-vernema',
      cropFamily: 'forage'
    });
    expect(alfalfa).toEqual([]);
  });

  it('the shipped grass hay crops are forage-grass and the legume hay crops stay forage', () => {
    for (const id of [
      'orchard-grass-potomac',
      'timothy-climax',
      'sudangrass-piper',
      'bmr-sorghum-sudan'
    ]) {
      expect(pluginJson(`crops/${id}.json`).cropFamily).toBe('forage-grass');
    }
    for (const id of ['alfalfa-vernema', 'alfalfa-hi-gest-660', 'clover-red-mammoth']) {
      expect(pluginJson(`crops/${id}.json`).cropFamily).toBe('forage');
    }
  });

  it('property: re-tagging grass forage never lifts a stop the forage family had', () => {
    fc.assert(
      fc.property(classArb, (cls) => {
        if (killsFamily(cls, 'forage')) expect(killsFamily(cls, 'forage-grass')).toBe(true);
      })
    );
  });
});

describe('kill matrix — asparagus (#671)', () => {
  it('every class treats perennial vegetables as lethal until a label-sourced row lands', () => {
    fc.assert(
      fc.property(classArb, (cls) => {
        expect(killsFamily(cls, 'perennial-vegetable')).toBe(true);
      })
    );
  });

  it('the asparagus plugins are perennial-vegetable, not allium', () => {
    for (const id of [
      'asparagus-jersey-knight',
      'asparagus-millennium',
      'asparagus-purple-passion'
    ]) {
      expect(pluginJson(`crops/${id}.json`).cropFamily).toBe('perennial-vegetable');
    }
  });

  it('property: re-tagging asparagus never lifts a stop the allium family had', () => {
    fc.assert(
      fc.property(classArb, (cls) => {
        if (killsFamily(cls, 'allium')) expect(killsFamily(cls, 'perennial-vegetable')).toBe(true);
      })
    );
  });

  it('property: any herbicide over an asparagus planting is refused', () => {
    fc.assert(
      fc.property(fc.uniqueArray(classArb, { minLength: 1, maxLength: 3 }), (classes) => {
        const p: HerbicideProduct = {
          pluginId: 'mix',
          displayName: 'mix',
          activeIngredients: classes.map((c) => ({ name: c, chemistryClass: c }))
        };
        const v = checkCropCompatibility([p], {
          cropPluginId: 'asparagus-millennium',
          cropFamily: 'perennial-vegetable' as CropFamily
        });
        expect(v.length).toBe(classes.length);
      })
    );
  });
});
