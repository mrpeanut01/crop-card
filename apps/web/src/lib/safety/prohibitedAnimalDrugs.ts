/**
 * 21 CFR 530.41: drugs prohibited from extra-label use in food-producing
 * animals. Written from knowledge, then checked paragraph by paragraph
 * against the eCFR text of 2026-09-28 (issue #469; the text is recorded in
 * apps/web/scripts/animal-health-sources.json). It errs toward including a
 * drug when unsure: over-blocking is the safe side.
 *
 * `onLabelExempt` is true only where FDA has approved food-animal labels,
 * so a plugin product used on its own label (C-13) proves the use was not
 * extra-label. It is the kernel's call, never a plugin's.
 *
 * `names` holds generic names and the US brand names a bottle may show
 * alone (a brand typed with no generic is otherwise an ordinary unknown
 * that one vet entry clears), plus stems such as `floxacin` that every
 * drug of a class carries. Label research Task 9 extends the brands.
 *
 * `prefixes` catches the generics of a class that share no inner stem but
 * start the same way (every sulfonamide starts `sulfa` or `sulfis`, every
 * cephalosporin `cef`/`ceph`), matched at the start of a spelling-folded
 * word; `notPrefixed` keeps out folded words that start that way and are
 * not the drug (sulfates, cephapirin and its Cefa-Lak/Cefa-Dri brands).
 *
 * `condition` narrows an entry only by facts the app actually records:
 * species, and an individual's sex. Unknowable conditions (dairy, age,
 * lactation, dose, indication) are applied as if met.
 */

export type ProhibitedCondition = 'female-or-unknown-sex';

export interface ProhibitedDrugEntry {
  id: string;
  cfr: string;
  label: string;
  names: readonly string[];
  species: 'any' | readonly string[];
  prefixes?: readonly string[];
  notPrefixed?: RegExp;
  condition?: ProhibitedCondition;
  onLabelExempt: boolean;
}

export const PROHIBITED_EXTRA_LABEL_DRUGS: readonly ProhibitedDrugEntry[] = [
  {
    id: 'chloramphenicol',
    cfr: '21 CFR 530.41(a)(1)',
    label: 'Chloramphenicol',
    names: ['chloramphenicol', 'chloromycetin', 'viceton'],
    species: 'any',
    onLabelExempt: false
  },
  {
    id: 'clenbuterol',
    cfr: '21 CFR 530.41(a)(2)',
    label: 'Clenbuterol',
    names: ['clenbuterol', 'ventipulmin'],
    species: 'any',
    onLabelExempt: false
  },
  {
    id: 'diethylstilbestrol',
    cfr: '21 CFR 530.41(a)(3)',
    label: 'Diethylstilbestrol (DES)',
    names: ['diethylstilbestrol', 'stilbestrol', 'des'],
    species: 'any',
    onLabelExempt: false
  },
  {
    id: 'dimetridazole',
    cfr: '21 CFR 530.41(a)(4)',
    label: 'Dimetridazole',
    names: ['dimetridazole', 'emtryl'],
    species: 'any',
    onLabelExempt: false
  },
  {
    id: 'ipronidazole',
    cfr: '21 CFR 530.41(a)(5)',
    label: 'Ipronidazole',
    names: ['ipronidazole'],
    species: 'any',
    onLabelExempt: false
  },
  {
    id: 'nitroimidazoles',
    cfr: '21 CFR 530.41(a)(6)',
    label: 'Nitroimidazoles',
    names: [
      'nitroimidazole',
      'metronidazole',
      'flagyl',
      'ronidazole',
      'tinidazole',
      'secnidazole',
      'carnidazole',
      'ornidazole',
      'benznidazole'
    ],
    species: 'any',
    onLabelExempt: false
  },
  {
    id: 'furazolidone',
    cfr: '21 CFR 530.41(a)(7)',
    label: 'Furazolidone',
    names: [
      'furazolidone',
      'nitrofuran',
      'nitrofurantoin',
      'furaltadone',
      'nifursol',
      'furox',
      'topazone',
      'nf 180'
    ],
    species: 'any',
    onLabelExempt: true
  },
  {
    id: 'nitrofurazone',
    cfr: '21 CFR 530.41(a)(8)',
    label: 'Nitrofurazone',
    names: ['nitrofurazone', 'nitrofural', 'furacin', 'furazone', 'fura zone', 'nfz'],
    species: 'any',
    onLabelExempt: true
  },
  {
    id: 'sulfonamides-lactating-dairy',
    cfr: '21 CFR 530.41(a)(9)',
    label: 'Sulfonamides in lactating dairy cattle',
    names: [
      'sulfonamide',
      'sulfa',
      'sulfadimethoxine',
      'sulfabromomethazine',
      'sulfaethoxypyridazine',
      'sulfamethazine',
      'sulfadimidine',
      'sulfamethoxazole',
      'sulfadiazine',
      'sulfadoxine',
      'sulfathiazole',
      'sulfaquinoxaline',
      'sulfachlorpyridazine',
      'sulfisoxazole',
      'sulfamerazine',
      'sulfapyridine',
      'sulfaguanidine',
      'sulfanilamide',
      'sulfacetamide',
      'sulfasalazine',
      'trimethoprim sulfa',
      'albon',
      'di methox',
      'sustain iii',
      'smz tmp',
      'smz',
      'sdm',
      'sulmet',
      'hava span',
      'aureo s',
      'aureo s 700',
      'aureo sp 250',
      'aureomix s',
      'as 700',
      'asp 250',
      'pennchlor sp',
      'bactrim',
      'tribrissen'
    ],
    prefixes: ['sulfa', 'sulfis'],
    notPrefixed: /^sulfat(e|es|ed|o|os)?$/,
    species: ['cattle'],
    condition: 'female-or-unknown-sex',
    onLabelExempt: true
  },
  {
    id: 'fluoroquinolones',
    cfr: '21 CFR 530.41(a)(10)',
    label: 'Fluoroquinolones',
    names: [
      'fluoroquinolone',
      'floxacin',
      'enrofloxacin',
      'enroflox',
      'enrosite',
      'enroquin',
      'enrotab',
      'baytril',
      'a180',
      'danofloxacin',
      'advocin',
      'marbofloxacin',
      'zeniquin',
      'marbocyl',
      'marboquin',
      'orbifloxacin',
      'orbax',
      'difloxacin',
      'dicural',
      'pradofloxacin',
      'veraflox',
      'sarafloxacin',
      'ciprofloxacin',
      'cipro',
      'levofloxacin',
      'ofloxacin',
      'norfloxacin',
      'moxifloxacin',
      'gatifloxacin',
      'ibafloxacin'
    ],
    species: 'any',
    onLabelExempt: true
  },
  {
    id: 'glycopeptides',
    cfr: '21 CFR 530.41(a)(11)',
    label: 'Glycopeptides',
    names: [
      'glycopeptide',
      'vancomycin',
      'vancocin',
      'avoparcin',
      'teicoplanin',
      'telavancin',
      'dalbavancin',
      'oritavancin'
    ],
    species: 'any',
    onLabelExempt: false
  },
  {
    id: 'phenylbutazone-female-dairy',
    cfr: '21 CFR 530.41(a)(12)',
    label: 'Phenylbutazone in female dairy cattle 20 months or older',
    names: [
      'phenylbutazone',
      'bute',
      'butazolidin',
      'equipalazone',
      'phenylzone',
      'butequine',
      'phenylbute'
    ],
    species: ['cattle'],
    condition: 'female-or-unknown-sex',
    onLabelExempt: false
  },
  {
    id: 'cephalosporins',
    cfr: '21 CFR 530.41(a)(13)',
    label: 'Cephalosporins (not cephapirin) in cattle, swine, chickens or turkeys',
    names: [
      'cephalosporin',
      'ceftiofur',
      'excenel',
      'excede',
      'naxcel',
      'spectramast',
      'cefquinome',
      'cefovecin',
      'convenia',
      'cefpodoxime',
      'simplicef',
      'cephalexin',
      'cefalexin',
      'keflex',
      'rilexine',
      'vetolexin',
      'cefadroxil',
      'cefazolin',
      'cefalonium',
      'cefuroxime',
      'cefoxitin',
      'cefotaxime',
      'ceftriaxone',
      'ceftazidime',
      'cefepime',
      'cefixime',
      'cefaclor',
      'cefoperazone',
      'cefalotin',
      'cephalothin'
    ],
    prefixes: ['cef'],
    notPrefixed: /^cefapirin|^cefa(lak|dri)?$/,
    species: ['cattle', 'pig', 'chicken'],
    onLabelExempt: true
  },
  {
    id: 'adamantanes-poultry',
    cfr: '21 CFR 530.41(d)(1)',
    label: 'Adamantanes in chickens, turkeys and ducks',
    names: ['adamantane', 'amantadine', 'rimantadine', 'symmetrel', 'flumadine'],
    species: ['chicken', 'duck'],
    onLabelExempt: false
  },
  {
    id: 'neuraminidase-inhibitors-poultry',
    cfr: '21 CFR 530.41(d)(2)',
    label: 'Neuraminidase inhibitors in chickens, turkeys and ducks',
    names: [
      'neuraminidase inhibitor',
      'oseltamivir',
      'tamiflu',
      'zanamivir',
      'relenza',
      'peramivir',
      'rapivab',
      'laninamivir'
    ],
    species: ['chicken', 'duck'],
    onLabelExempt: false
  }
];

export interface ProhibitedDrugQuery {
  speciesId: string;
  sex?: string | null;
  texts: readonly (string | null | undefined)[];
}

export function normalizeDrugText(text: string): string {
  return ` ${text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

export function foldDrugSpelling(text: string): string {
  return normalizeDrugText(text)
    .replace(/ /g, '')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/ch/g, 'c')
    .replace(/y/g, 'i')
    .replace(/mf/g, 'nf');
}

const MIN_GLUED = 6;

function textNamesDrug(normalized: string, folded: string, name: string): boolean {
  const needle = normalizeDrugText(name);
  if (needle.trim().length === 0) return false;
  if (normalized.includes(needle)) return true;
  const glued = needle.trim().replace(/ /g, '');
  if (glued.length < MIN_GLUED) return false;
  if (normalized.replace(/ /g, '').includes(glued)) return true;
  const foldedNeedle = foldDrugSpelling(name);
  if (folded.includes(foldedNeedle)) return true;
  const stem = foldedNeedle.replace(/[aeio]$/, '');
  return stem.length >= MIN_GLUED && folded.includes(stem);
}

function wordHasPrefix(
  words: readonly string[],
  prefixes: readonly string[],
  notPrefixed: RegExp | undefined
): boolean {
  return words.some(
    (w) => prefixes.some((p) => w.startsWith(p)) && !(notPrefixed && notPrefixed.test(w))
  );
}

function conditionMet(condition: ProhibitedCondition | undefined, sex: string | null | undefined) {
  if (!condition) return true;
  return sex !== 'male' && sex !== 'neutered-male';
}

export function matchProhibitedDrugs(query: ProhibitedDrugQuery): ProhibitedDrugEntry[] {
  const texts = query.texts
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((t) => {
      const normalized = normalizeDrugText(t);
      return {
        normalized,
        folded: foldDrugSpelling(t),
        words: normalized
          .trim()
          .split(' ')
          .map((w) => foldDrugSpelling(w))
      };
    });
  if (texts.length === 0) return [];
  return PROHIBITED_EXTRA_LABEL_DRUGS.filter((entry) => {
    if (entry.species !== 'any' && !entry.species.includes(query.speciesId)) return false;
    if (!conditionMet(entry.condition, query.sex)) return false;
    const prefixes = entry.prefixes ?? [];
    return (
      entry.names.some((name) =>
        texts.some((text) => textNamesDrug(text.normalized, text.folded, name))
      ) ||
      (prefixes.length > 0 &&
        texts.some((text) => wordHasPrefix(text.words, prefixes, entry.notPrefixed)))
    );
  });
}
