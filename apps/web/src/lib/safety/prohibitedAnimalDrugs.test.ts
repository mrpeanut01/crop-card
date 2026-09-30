import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  matchProhibitedDrugs,
  normalizeDrugText,
  PROHIBITED_EXTRA_LABEL_DRUGS
} from './prohibitedAnimalDrugs';

const ids = (q: Parameters<typeof matchProhibitedDrugs>[0]) =>
  matchProhibitedDrugs(q).map((m) => m.id);

describe('PROHIBITED_EXTRA_LABEL_DRUGS table', () => {
  it('cites a 21 CFR 530.41 paragraph on every entry', () => {
    for (const entry of PROHIBITED_EXTRA_LABEL_DRUGS) {
      expect(entry.cfr).toMatch(/^21 CFR 530\.41\((a|b)\)\(\d+\)$/);
      expect(entry.names.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it('has unique ids and unique paragraphs', () => {
    const idSet = new Set(PROHIBITED_EXTRA_LABEL_DRUGS.map((e) => e.id));
    const cfrSet = new Set(PROHIBITED_EXTRA_LABEL_DRUGS.map((e) => e.cfr));
    expect(idSet.size).toBe(PROHIBITED_EXTRA_LABEL_DRUGS.length);
    expect(cfrSet.size).toBe(PROHIBITED_EXTRA_LABEL_DRUGS.length);
  });

  it.each([
    ['chloramphenicol', '21 CFR 530.41(a)(1)'],
    ['clenbuterol', '21 CFR 530.41(a)(2)'],
    ['diethylstilbestrol', '21 CFR 530.41(a)(3)'],
    ['dimetridazole', '21 CFR 530.41(a)(4)'],
    ['ipronidazole', '21 CFR 530.41(a)(5)'],
    ['nitroimidazoles', '21 CFR 530.41(a)(6)'],
    ['furazolidone', '21 CFR 530.41(a)(7)'],
    ['nitrofurazone', '21 CFR 530.41(a)(8)'],
    ['sulfonamides-lactating-dairy', '21 CFR 530.41(a)(9)'],
    ['fluoroquinolones', '21 CFR 530.41(a)(10)'],
    ['glycopeptides', '21 CFR 530.41(a)(11)'],
    ['phenylbutazone-female-dairy', '21 CFR 530.41(a)(12)'],
    ['cephalosporins', '21 CFR 530.41(a)(13)'],
    ['adamantanes-poultry', '21 CFR 530.41(d)(1)'],
    ['neuraminidase-inhibitors-poultry', '21 CFR 530.41(d)(2)']
  ])('lists %s under %s', (id, cfr) => {
    expect(PROHIBITED_EXTRA_LABEL_DRUGS.find((e) => e.id === id)?.cfr).toBe(cfr);
  });

  it('never lists cephapirin, which the regulation excludes', () => {
    const all = PROHIBITED_EXTRA_LABEL_DRUGS.flatMap((e) => e.names);
    expect(all).not.toContain('cephapirin');
  });

  it('only lets drugs with approved food-animal labels be exempted by an on-label use', () => {
    const exempt = PROHIBITED_EXTRA_LABEL_DRUGS.filter((e) => e.onLabelExempt).map((e) => e.id);
    expect(exempt.sort()).toEqual(
      [
        'cephalosporins',
        'fluoroquinolones',
        'furazolidone',
        'nitrofurazone',
        'sulfonamides-lactating-dairy'
      ].sort()
    );
  });
});

describe('matchProhibitedDrugs', () => {
  it.each([
    ['Baytril 100', 'chicken', 'fluoroquinolones'],
    ['enrofloxacin injectable', 'goat', 'fluoroquinolones'],
    ['ENRO-FLOX', 'sheep', 'fluoroquinolones'],
    ['Cipro 500 mg', 'duck', 'fluoroquinolones'],
    ['Excede', 'cattle', 'cephalosporins'],
    ['ceftiofur sodium', 'pig', 'cephalosporins'],
    ['Cephalexin 500mg', 'chicken', 'cephalosporins'],
    ['Flagyl (metronidazole)', 'goat', 'nitroimidazoles'],
    ['Chloramphenicol palmitate', 'rabbit', 'chloramphenicol'],
    ['Ventipulmin syrup', 'horse', 'clenbuterol'],
    ['vancomycin', 'pig', 'glycopeptides'],
    ['Tamiflu', 'chicken', 'neuraminidase-inhibitors-poultry'],
    ['amantadine', 'duck', 'adamantanes-poultry'],
    ['nitrofurazone dressing', 'horse', 'nitrofurazone'],
    ['Furazolidone powder', 'sheep', 'furazolidone']
  ])('%s on a %s matches %s', (text, speciesId, expected) => {
    const matched = ids({ speciesId, texts: [text] });
    if (expected === null) expect(matched).toEqual([]);
    else expect(matched).toContain(expected);
  });

  it('matches glued and plural spellings', () => {
    expect(ids({ speciesId: 'goat', texts: ['Sulfonamides'] })).toEqual([]);
    expect(ids({ speciesId: 'cattle', texts: ['Sulfonamides'] })).toContain(
      'sulfonamides-lactating-dairy'
    );
    expect(ids({ speciesId: 'chicken', texts: ['cipro floxacin'] })).toContain('fluoroquinolones');
  });

  it('keeps species-limited entries to their species', () => {
    expect(ids({ speciesId: 'goat', texts: ['ceftiofur'] })).toEqual([]);
    expect(ids({ speciesId: 'sheep', texts: ['oseltamivir'] })).toEqual([]);
    expect(ids({ speciesId: 'chicken', texts: ['phenylbutazone'] })).toEqual([]);
  });

  it('applies the female dairy conditions unless the animal is known male', () => {
    expect(ids({ speciesId: 'cattle', sex: 'female', texts: ['Bute'] })).toContain(
      'phenylbutazone-female-dairy'
    );
    expect(ids({ speciesId: 'cattle', sex: null, texts: ['Bute'] })).toContain(
      'phenylbutazone-female-dairy'
    );
    expect(ids({ speciesId: 'cattle', sex: 'unknown', texts: ['Bute'] })).toContain(
      'phenylbutazone-female-dairy'
    );
    expect(ids({ speciesId: 'cattle', sex: 'male', texts: ['Bute'] })).toEqual([]);
    expect(ids({ speciesId: 'cattle', sex: 'neutered-male', texts: ['sulfadimethoxine'] })).toEqual(
      []
    );
  });

  it('does not match unrelated products', () => {
    for (const text of [
      'Ivermectin pour-on',
      'Fenbendazole',
      'Copper sulfate',
      'Neomycin sulfate',
      'Florfenicol',
      'Oxytetracycline',
      'Cephapirin benzathine',
      'Amprolium'
    ]) {
      expect(ids({ speciesId: 'cattle', sex: 'female', texts: [text] })).toEqual([]);
    }
  });

  it('ignores empty and missing text', () => {
    expect(ids({ speciesId: 'cattle', texts: [] })).toEqual([]);
    expect(ids({ speciesId: 'cattle', texts: [null, undefined, '  '] })).toEqual([]);
  });

  it('matches any listed name embedded in arbitrary surrounding text', () => {
    const species = fc.constantFrom('cattle', 'pig', 'chicken', 'duck', 'goat', 'sheep', 'horse');
    const entryArb = fc.constantFrom(...PROHIBITED_EXTRA_LABEL_DRUGS);
    fc.assert(
      fc.property(
        entryArb,
        species,
        fc.string({ maxLength: 12 }),
        fc.string({ maxLength: 12 }),
        (entry, speciesId, before, after) => {
          fc.pre(entry.species === 'any' || entry.species.includes(speciesId));
          const name = entry.names[0];
          const matched = ids({
            speciesId,
            sex: 'female',
            texts: [`${before} ${name.toUpperCase()} ${after}`]
          });
          expect(matched).toContain(entry.id);
        }
      )
    );
  });

  it.each([
    ['Enrofloxacína', 'fluoroquinolones'],
    ['Ceftiofúr', 'cephalosporins'],
    ['Metronidazol', 'nitroimidazoles'],
    ['Cloranfenicol', 'chloramphenicol'],
    ['Nitrofurazona', 'nitrofurazone'],
    ['Furazolidona', 'furazolidone'],
    ['Sulfametazina', 'sulfonamides-lactating-dairy'],
    ['Sulfadimetoxina', 'sulfonamides-lactating-dairy'],
    ['Ｂａｙｔｒｉｌ', 'fluoroquinolones'],
    ['ＥＮＲＯＦＬＯＸＡＣＩＮ', 'fluoroquinolones'],
    ['Vancomicina', 'glycopeptides'],
    ['Fenilbutazona', 'phenylbutazone-female-dairy'],
    ['Cefalexina', 'cephalosporins'],
    ['Ceftriaxona', 'cephalosporins'],
    ['Dietilestilbestrol', 'diethylstilbestrol'],
    ['Ciprofloxacino', 'fluoroquinolones'],
    ['Clenbuterol clorhidrato', 'clenbuterol']
  ])('matches the accented, full-width or Spanish/Portuguese spelling %s', (text, id) => {
    expect(ids({ speciesId: 'cattle', sex: 'female', texts: [text] })).toContain(id);
  });

  it('keeps cephapirin, florfenicol and sulfates out after spelling folding', () => {
    for (const text of ['Cefapirina', 'Florfenicol', 'Sulfato de cobre', 'Neomicina sulfato']) {
      expect(ids({ speciesId: 'cattle', sex: 'female', texts: [text] })).toEqual([]);
    }
  });

  it('normalizes punctuation and case', () => {
    expect(normalizeDrugText('Baytril®-100 (Enrofloxacin)')).toBe(' baytril 100 enrofloxacin ');
  });
});

describe('US brand names typed alone (review round 4)', () => {
  const ids = (q: Parameters<typeof matchProhibitedDrugs>[0]) =>
    matchProhibitedDrugs(q).map((e) => e.id);
  it.each([
    ['chicken', 'Enroflox 100', 'fluoroquinolones'],
    ['chicken', 'Enrofloxacine', 'fluoroquinolones'],
    ['cattle', 'Advocin A180', 'fluoroquinolones'],
    ['cattle', 'Sulmet', 'sulfonamides-lactating-dairy'],
    ['cattle', 'Aureo S 700', 'sulfonamides-lactating-dairy'],
    ['cattle', 'Aureo S-700 crumbles', 'sulfonamides-lactating-dairy'],
    ['cattle', 'ASP 250', 'sulfonamides-lactating-dairy'],
    ['cattle', 'Phenylzone paste', 'phenylbutazone-female-dairy'],
    ['cattle', 'Topazone aerosol', 'furazolidone'],
    ['cattle', 'NFZ puffer', 'nitrofurazone'],
    ['pig', 'Rilexine', 'cephalosporins'],
    ['chicken', 'Symmetrel', 'adamantanes-poultry']
  ])('%s: %s is prohibited', (speciesId, text, id) => {
    expect(ids({ speciesId, sex: 'female', texts: [text] })).toContain(id);
  });

  it('plain chlortetracycline and oxytetracycline stay out', () => {
    for (const text of ['Aureomycin 90', 'Aureomycin crumbles', 'LA-200', 'Terramycin']) {
      expect(ids({ speciesId: 'cattle', sex: 'female', texts: [text] })).toEqual([]);
    }
  });
});

describe('generic and INN names of the listed classes (review round 5)', () => {
  const ids = (q: Parameters<typeof matchProhibitedDrugs>[0]) =>
    matchProhibitedDrugs(q).map((e) => e.id);
  it.each([
    ['cattle', 'Sulfamethizole', 'sulfonamides-lactating-dairy'],
    ['cattle', 'Sulfamethoxypyridazine', 'sulfonamides-lactating-dairy'],
    ['cattle', 'Sulfachloropyrazine', 'sulfonamides-lactating-dairy'],
    ['cattle', 'Sulfanitran', 'sulfonamides-lactating-dairy'],
    ['cattle', 'Sulfisomidine', 'sulfonamides-lactating-dairy'],
    ['cattle', 'Sulfameter', 'sulfonamides-lactating-dairy'],
    ['cattle', 'Sulfaphenazole', 'sulfonamides-lactating-dairy'],
    ['cattle', 'Sulfalene', 'sulfonamides-lactating-dairy'],
    ['cattle', 'Sulfatroxazole', 'sulfonamides-lactating-dairy'],
    ['cattle', 'Sulphamethizole bolus', 'sulfonamides-lactating-dairy'],
    ['cattle', 'Cephradine', 'cephalosporins'],
    ['cattle', 'Cefradine', 'cephalosporins'],
    ['pig', 'Cefdinir', 'cephalosporins'],
    ['cattle', 'Cefprozil', 'cephalosporins'],
    ['cattle', 'Cephaloridine', 'cephalosporins'],
    ['cattle', 'Cefotetan', 'cephalosporins'],
    ['cattle', 'Ceftaroline', 'cephalosporins'],
    ['chicken', 'Ceftizoxime', 'cephalosporins'],
    ['cattle', 'Nitrofural', 'nitrofurazone'],
    ['goat', 'Nitrofural ointment', 'nitrofurazone']
  ])('%s: %s is prohibited', (speciesId, text, id) => {
    expect(ids({ speciesId, sex: 'female', texts: [text] })).toContain(id);
  });

  it('keeps sulfates, sulfur, cephapirin and its brands out', () => {
    for (const text of [
      'Copper sulfate',
      'Zinc sulfate footbath',
      'Sulfato de cobre',
      'Lime sulfur dip',
      'Sulphur',
      'Cephapirin benzathine',
      'Cefa-Lak',
      'Cefa-Dri',
      'Cefapirina'
    ]) {
      expect(ids({ speciesId: 'cattle', sex: 'female', texts: [text] })).toEqual([]);
    }
  });

  it('keeps the class prefixes to their species and sex', () => {
    expect(ids({ speciesId: 'goat', sex: 'female', texts: ['Cephradine'] })).toEqual([]);
    expect(ids({ speciesId: 'cattle', sex: 'male', texts: ['Sulfamethizole'] })).toEqual([]);
  });
});
