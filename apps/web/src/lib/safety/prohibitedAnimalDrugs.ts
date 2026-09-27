/**
 * 21 CFR 530.41: drugs prohibited from extra-label use in food-producing
 * animals (RULES_VERSION 0.6.0). Written from knowledge, not from a fetched
 * eCFR page, so it errs toward including a drug when unsure: over-blocking
 * is the safe side. docs/research/label-research-prompt.md Task 9 requires
 * checking it against the current eCFR before launch.
 *
 * `onLabelExempt` is true only where FDA has approved food-animal labels,
 * so a plugin product used on its own label (C-13) proves the use was not
 * extra-label. It is the kernel's call, never a plugin's.
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
  condition?: ProhibitedCondition;
  onLabelExempt: boolean;
}

export const PROHIBITED_EXTRA_LABEL_DRUGS: readonly ProhibitedDrugEntry[] = [
  {
    id: 'chloramphenicol',
    cfr: '21 CFR 530.41(a)(1)',
    label: 'Chloramphenicol',
    names: ['chloramphenicol', 'chloromycetin'],
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
    names: ['dimetridazole'],
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
    names: ['furazolidone', 'nitrofuran', 'nitrofurantoin', 'furaltadone', 'nifursol'],
    species: 'any',
    onLabelExempt: true
  },
  {
    id: 'nitrofurazone',
    cfr: '21 CFR 530.41(a)(8)',
    label: 'Nitrofurazone',
    names: ['nitrofurazone', 'furacin'],
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
      'bactrim',
      'tribrissen'
    ],
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
      'enrofloxacin',
      'baytril',
      'danofloxacin',
      'advocin',
      'marbofloxacin',
      'zeniquin',
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
    names: ['phenylbutazone', 'bute', 'butazolidin', 'equipalazone'],
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
    species: ['cattle', 'pig', 'chicken'],
    onLabelExempt: true
  },
  {
    id: 'adamantanes-poultry',
    cfr: '21 CFR 530.41(b)(1)',
    label: 'Adamantanes in chickens, turkeys and ducks',
    names: ['adamantane', 'amantadine', 'rimantadine'],
    species: ['chicken', 'duck'],
    onLabelExempt: false
  },
  {
    id: 'neuraminidase-inhibitors-poultry',
    cfr: '21 CFR 530.41(b)(2)',
    label: 'Neuraminidase inhibitors in chickens, turkeys and ducks',
    names: [
      'neuraminidase inhibitor',
      'oseltamivir',
      'tamiflu',
      'zanamivir',
      'relenza',
      'peramivir',
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
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

function textNamesDrug(normalized: string, name: string): boolean {
  const needle = normalizeDrugText(name);
  if (needle.trim().length === 0) return false;
  if (normalized.includes(needle)) return true;
  const glued = needle.trim().replace(/ /g, '');
  return glued.length >= 6 && normalized.replace(/ /g, '').includes(glued);
}

function conditionMet(condition: ProhibitedCondition | undefined, sex: string | null | undefined) {
  if (!condition) return true;
  return sex !== 'male' && sex !== 'neutered-male';
}

export function matchProhibitedDrugs(query: ProhibitedDrugQuery): ProhibitedDrugEntry[] {
  const normalized = query.texts
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map(normalizeDrugText);
  if (normalized.length === 0) return [];
  return PROHIBITED_EXTRA_LABEL_DRUGS.filter((entry) => {
    if (entry.species !== 'any' && !entry.species.includes(query.speciesId)) return false;
    if (!conditionMet(entry.condition, query.sex)) return false;
    return entry.names.some((name) => normalized.some((text) => textNamesDrug(text, name)));
  });
}
