import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { loadPluginsFromDirectory } from '$lib/plugins/loader';
import { PluginRegistry } from '$lib/plugins/registry';
import { DIAGNOSIS_WORDS, markDiagnosisTerms, namesDiagnosis, namesTreatment } from './markGuard';
import { MAX_MARK_LABEL, isUnsafeMarkLabel, parseMarks } from './marks';
import { sprayProductTerms } from './photoHelp';
import { BYPASS_PHRASINGS, PROBLEM_LABEL_BYPASS, SAFE_PROBLEM_LABELS } from './markLabels.fixtures';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');

let library: PluginRegistry;
let targets: string[];
let terms: string[];
let sprayTerms: string[];

beforeAll(async () => {
  library = new PluginRegistry();
  await loadPluginsFromDirectory(library, path.join(REPO_ROOT, 'plugins'));
  targets = library.all().flatMap(({ plugin: p }) => {
    if (p.type === 'insecticide') {
      return [...(p.targetPests ?? []), ...(p.scoutingThresholds ?? []).map((t) => t.pest)];
    }
    if (p.type === 'fungicide') return [...(p.targetDiseases ?? [])];
    return [];
  });
  terms = markDiagnosisTerms(targets);
  sprayTerms = sprayProductTerms(
    library.all().flatMap(({ plugin: p }) =>
      p.type === 'herbicide' || p.type === 'insecticide' || p.type === 'fungicide'
        ? [
            {
              displayName: p.displayName,
              activeIngredients: p.activeIngredients.map((a) => a.name)
            }
          ]
        : []
    )
  );
});

const problem = (label: string) => [{ kind: 'problem', x: 0.5, y: 0.5, label }];

describe('problem mark labels (#869, FU869-1)', () => {
  it.each(SAFE_PROBLEM_LABELS)('lets the visible description "%s" through', (label) => {
    expect(isUnsafeMarkLabel(label, sprayTerms)).toBe(false);
    expect(namesDiagnosis(label, terms)).toBe(false);
    expect(namesTreatment(label)).toBe(false);
    expect(parseMarks(problem(label), sprayTerms, terms).ok).toBe(true);
  });

  it('refuses every red-team problem label, with the guard and never the length check', () => {
    expect(PROBLEM_LABEL_BYPASS.length).toBeGreaterThanOrEqual(50);
    for (const label of PROBLEM_LABEL_BYPASS) {
      expect(label.length, label).toBeLessThanOrEqual(MAX_MARK_LABEL);
      const out = parseMarks(problem(label), sprayTerms, terms);
      expect(out.ok, label).toBe(false);
      if (!out.ok) {
        expect(['spray-label', 'diagnosis-label', 'treatment-label'], label).toContain(out.reason);
      }
    }
  });

  it('refuses the 41 photo-help bypass phrasings as problem labels too', () => {
    expect(BYPASS_PHRASINGS).toHaveLength(41);
    for (const phrase of BYPASS_PHRASINGS) {
      expect(parseMarks(problem(phrase), sprayTerms, terms).ok, phrase).toBe(false);
    }
  });

  it('drops the whole set when one problem label fails, wherever it sits', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...SAFE_PROBLEM_LABELS), { maxLength: 5 }),
        fc.constantFrom(...PROBLEM_LABEL_BYPASS),
        fc.array(fc.constantFrom(...SAFE_PROBLEM_LABELS), { maxLength: 5 }),
        (before, bad, after) => {
          const raw = [...before, bad, ...after].flatMap(problem);
          expect(parseMarks(raw, sprayTerms, terms).ok).toBe(false);
        }
      )
    );
  });

  it('keeps the treatment check to problem labels, so action marks still say what to do', () => {
    for (const label of ['Cut above this leaf pair', 'Pinch the tip', 'Harvest from the outside']) {
      expect(namesTreatment(label), label).toBe(true);
      expect(parseMarks([{ kind: 'cut', x: 0.5, y: 0.5, label }], sprayTerms, terms).ok).toBe(true);
      expect(parseMarks(problem(label), sprayTerms, terms)).toEqual({
        ok: false,
        reason: 'treatment-label'
      });
    }
  });

  it('runs the diagnosis check on every kind of mark', () => {
    for (const kind of ['cut', 'pinch', 'harvest', 'leave']) {
      expect(
        parseMarks([{ kind, x: 0.5, y: 0.5, label: 'Cut out the blight' }], sprayTerms, terms)
      ).toEqual({ ok: false, reason: 'diagnosis-label' });
    }
  });
});

const SAFE_WORDS = [
  'yellow',
  'brown',
  'black',
  'white',
  'pale',
  'dark',
  'lower',
  'upper',
  'new',
  'old',
  'leaves',
  'spots',
  'spotted',
  'holes',
  'edges',
  'tips',
  'stem',
  'stems',
  'curled',
  'wilted',
  'dry',
  'sunken',
  'patch',
  'powder',
  'webbing',
  'sticky',
  'shiny',
  'chewed',
  'torn',
  'mottled',
  'stunted',
  'growth',
  'fruit',
  'soft',
  'base',
  'water-soaked',
  'on',
  'under',
  'these',
  'near',
  'small',
  'large',
  'thin',
  'spindly',
  'faded',
  'streaks',
  'rings',
  'cracked',
  'droopy'
];

const LEET: Record<string, string> = { e: '3', a: '4', o: '0', i: '1', s: '5' };

/** A diagnosis word as someone hiding it might write it. */
function disguise(word: string, how: number, upper: boolean[]): string {
  const cased = [...word].map((c, i) => (upper[i % upper.length] ? c.toUpperCase() : c)).join('');
  switch (how) {
    case 0:
      return cased;
    case 1:
      return [...cased].map((c) => LEET[c.toLowerCase()] ?? c).join('');
    case 2:
      return [...cased].join(' ');
    case 3:
      return [...cased].join('.');
    case 4:
      if (/s$/.test(word)) return cased;
      return /[^aeiou]y$/.test(word) ? `${cased.slice(0, -1)}ies` : `${cased}s`;
    default:
      return [...cased].join('_');
  }
}

describe('namesDiagnosis', () => {
  const singleWords = DIAGNOSIS_WORDS.filter((w) => /^[a-z]+$/.test(w));

  it('finds a pest, disease or weed word however it is cased, spelled out or leeted', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...SAFE_WORDS), { maxLength: 3 }),
        fc.constantFrom(...singleWords),
        fc.integer({ min: 0, max: 5 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }),
        fc.array(fc.constantFrom(...SAFE_WORDS), { maxLength: 3 }),
        (before, word, how, upper, after) => {
          const label = [...before, disguise(word, how, upper), ...after].join(' ');
          expect(namesDiagnosis(label, terms), label).toBe(true);
        }
      ),
      { numRuns: 400 }
    );
  });

  it('never fires on plain descriptions of what is visible', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...SAFE_WORDS), { minLength: 1, maxLength: 6 }), (w) => {
        const label = w.join(' ');
        expect(namesDiagnosis(label, terms), label).toBe(false);
        expect(namesTreatment(label), label).toBe(false);
        expect(isUnsafeMarkLabel(label, sprayTerms), label).toBe(false);
      }),
      { numRuns: 400 }
    );
  });

  it("refuses every pest and disease named on the library's labels", () => {
    expect(targets.length).toBeGreaterThan(100);
    for (const name of targets) {
      expect(namesDiagnosis(name, terms), name).toBe(true);
      expect(namesDiagnosis(`${name.replace(/\([^)]*\)/g, '').trim()} here`, terms), name).toBe(
        true
      );
    }
  });

  it('never matches the name of a crop in the library, so a harvest label may name its plant', () => {
    const crops = library.crops();
    expect(crops.length).toBeGreaterThan(100);
    const hits = crops
      .map((c) =>
        c.displayName
          .replace(/\([^)]*\)/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter((name) => namesDiagnosis(name, terms));
    expect(hits).toEqual([]);
  });

  it('turns library target names into match terms', () => {
    expect(
      markDiagnosisTerms([
        'white mold (Sclerotinia)',
        'spider mite suppression',
        'twospotted spider mite eggs and immatures',
        'Botrytis (gray mold)',
        'stink bug (knockdown only)',
        'Tizón'
      ])
    ).toEqual([
      'botrytis',
      'spider mite',
      'stink bug',
      'tizon',
      'twospotted spider mite',
      'white mold'
    ]);
  });

  it('reads accents off, so a Spanish word meets its plain spelling', () => {
    expect(namesDiagnosis('Pulgón en el tallo')).toBe(true);
    expect(namesDiagnosis('Ácaros bajo la hoja')).toBe(true);
  });
});

const TREATMENT_WORDS = [
  'treat',
  'treated',
  'cure',
  'fix',
  'apply',
  'remove',
  'removed',
  'prune',
  'trim',
  'control',
  'prevent',
  'feed',
  'fertilize',
  'add',
  'needs',
  'should',
  'use',
  'try',
  'deficiency',
  'nitrogen',
  'because',
  'caused by',
  'looks like',
  'maybe',
  'too much',
  'not enough',
  'sunscald',
  'frost damage',
  'overwatered',
  'stress'
];

describe('namesTreatment', () => {
  it('finds a treatment, a fix or a cause anywhere in a problem label', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...SAFE_WORDS), { maxLength: 3 }),
        fc.constantFrom(...TREATMENT_WORDS),
        fc.boolean(),
        fc.array(fc.constantFrom(...SAFE_WORDS), { maxLength: 3 }),
        (before, word, shout, after) => {
          const label = [...before, shout ? word.toUpperCase() : word, ...after].join(' ');
          expect(namesTreatment(label), label).toBe(true);
          expect(parseMarks(problem(label)).ok, label).toBe(false);
        }
      ),
      { numRuns: 300 }
    );
  });
});
