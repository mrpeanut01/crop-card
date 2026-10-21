/** The checks a photo mark label gets on top of the spray-advice guard
 *  (#869, FU869-1). Pure and client-safe. `asksForSprayAdvice` stays the one
 *  spray guard (C-8); this adds two refusals. Every label is refused when it
 *  names a pest, a disease or a weed, since a diagnosis here has no source.
 *  A `problem` label is also refused when it names a treatment, a fix or a
 *  cause: it says only what the photo shows ("yellow lower leaves"). */

import { normalizeQuestion } from './photoHelp';

/** Pest, disease, weed and animal-damage words no label names, beyond the
 *  pesticide library's own target names (`markDiagnosisTerms`). Crop names
 *  never appear here (the crop-name test keeps it so): a harvest label may
 *  name the plant it is on. */
export const DIAGNOSIS_WORDS: readonly string[] = [
  'disease',
  'diseased',
  'infection',
  'infected',
  'infestation',
  'infested',
  'pathogen',
  'fungus',
  'fungi',
  'fungal',
  'mold',
  'mould',
  'moldy',
  'mildew',
  'mildewed',
  'mildewy',
  'blight',
  'blighted',
  'rot',
  'rotted',
  'rotten',
  'rotting',
  'rust',
  'scab',
  'canker',
  'wilt',
  'smut',
  'virus',
  'viral',
  'bacteria',
  'bacterium',
  'bacterial',
  'anthracnose',
  'botrytis',
  'septoria',
  'alternaria',
  'fusarium',
  'verticillium',
  'pythium',
  'phytophthora',
  'rhizoctonia',
  'sclerotinia',
  'cercospora',
  'damping off',
  'clubroot',
  'nematode',
  'pest',
  'insect',
  'bug',
  'aphid',
  'mite',
  'thrips',
  'whitefly',
  'beetle',
  'weevil',
  'borer',
  'worm',
  'cutworm',
  'hornworm',
  'armyworm',
  'earworm',
  'wireworm',
  'webworm',
  'fruitworm',
  'cabbageworm',
  'looper',
  'caterpillar',
  'larva',
  'larvae',
  'grub',
  'maggot',
  'slug',
  'snail',
  'moth',
  'leafhopper',
  'leafminer',
  'psyllid',
  'mealybug',
  'earwig',
  'grasshopper',
  'cricket',
  'gnat',
  'sawfly',
  'deer',
  'rabbit',
  'groundhog',
  'woodchuck',
  'squirrel',
  'vole',
  'gopher',
  'chipmunk',
  'raccoon',
  'mouse',
  'mice',
  'weed',
  'weedy',
  'crabgrass',
  'bindweed',
  'pigweed',
  'ragweed',
  'lambsquarters',
  'nutsedge',
  'johnsongrass',
  'quackgrass',
  'chickweed',
  'henbit',
  'smartweed',
  'velvetleaf',
  'marestail',
  'horseweed',
  'poison ivy',
  'dodder',
  'kudzu',
  'plaga',
  'hongo',
  'moho',
  'mildiu',
  'oidio',
  'roya',
  'tizon',
  'podredumbre',
  'pudricion',
  'enfermedad',
  'infeccion',
  'pulgon',
  'acaro',
  'arana roja',
  'mosca blanca',
  'trips',
  'gusano',
  'oruga',
  'babosa',
  'caracol',
  'escarabajo',
  'maleza',
  'mala hierba',
  'nematodo'
];

/** Words a `problem` label never holds: a treatment or a fix, an action to
 *  take, or a cause or a guess at one (FU869-1 b and c). */
const TREATMENT_PATTERNS: readonly RegExp[] = [
  /\b(?:treat|cure|cured|curing|heal|fix|remed|repair|restor|recover)\w*/,
  /\b(?:apply|applied|applies|applying|application)\b/,
  /\b(?:control|prevent|protect|manag|suppress|eradicat|eliminat|destroy|discard|dispos)\w*/,
  /\b(?:remov|prun|trim|pinch|snip|clip|pick|pull|uproot|dig|harvest)\w*/,
  /\bleave\b/,
  /\bcut(?:s|ting)?\b/,
  /\bburn\b/,
  /\b(?:fertili[sz]|feed|fed|compost|manure|mulch|amend|repot|transplant|replant|isolat|quarantin|wash|rinse|wipe|hose)\w*/,
  /\badd(?:s|ed|ing)?\b/,
  /\bmove\b/,
  /\b(?:water(?:ing)? (?:more|less|it|them|deeply|often)|more water|less water)\b/,
  /\b(?:use|try|should|must|needs?|needed|let|keep|avoid|stop|give|buy|get rid)\b/,
  /\b(?:deficien|toxicit|nutrient|overwater|underwater|over-water|under-water|overfertili|over-fertili|drought|stress|shock|sunscald|sunburn|frostbit|diagnos|symptom|suspect|possibl|probabl|likely)\w*/,
  /\b(?:nitrogen|phosphorus|potassium|calcium|magnesium|iron|zinc|boron|manganese)\b/,
  /\b(?:maybe|perhaps|because|caused?|causes|due to|not enough|lack(?:s|ing)?|seems?)\b/,
  /\btoo (?:much|little|many|few|wet|dry|hot|cold)\b/,
  /\b(?:signs? of|could be|might be|may be|looks? like)\b/,
  /\bfrom (?:the )?(?:frost|heat|sun|cold|drought|rain|wind|hail|spray|drift)\b/,
  /\b(?:frost|heat|cold|wind|hail|herbicide|chemical|drift|salt|sun) (?:damage|injury|burn|stress)\b/,
  /\b(?:tratar|tratamiento|curar|remedio|aplicar|fertilizar|abonar|carencia|deficiencia|exceso de|falta de)\b/
];

/** Lowercase, accents off, so "Tizón" meets "tizon". */
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The label as written and with leetspeak and letter-by-letter spelling
 *  undone (`normalizeQuestion`), both folded. */
function variants(label: string): string[] {
  const plain = fold(label.replace(/\s+/g, ' ').trim());
  const undone = fold(normalizeQuestion(label.replace(/\s+/g, ' ').trim()));
  return plain === undone ? [plain] : [plain, undone];
}

const QUALIFIER =
  /\s+(?:suppression|knockdown only|incidental|eggs and immatures|eggs|larvae|nymphs|pupae|immatures|adults)$/;

/** Pest, disease and weed names from the pesticide library's labels
 *  (insecticide `targetPests` and scouting pests, fungicide
 *  `targetDiseases`), turned into match terms: parentheticals and stage
 *  words such as "suppression" or "eggs" dropped, lowercased, accents off. */
export function markDiagnosisTerms(names: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    let name = fold(
      raw
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
    let prev = '';
    while (prev !== name) {
      prev = name;
      name = name.replace(QUALIFIER, '').trim();
    }
    if (name.length >= 3) out.add(name);
  }
  return [...out].sort();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One term as a pattern: words may be joined by a space, a hyphen, an
 *  underscore or nothing, and the last word may be plural. */
function termPattern(term: string): string {
  const words = term
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(escapeRe);
  if (!words.length) return '';
  const last = words.pop()!;
  let tail: string;
  if (/[^aeiou]y$/.test(last)) tail = `${last.slice(0, -1)}(?:y|ies)`;
  else if (/(?:s|x|ch|sh)$/.test(last)) tail = `${last}(?:es)?`;
  else tail = `${last}(?:s|es)?`;
  return [...words, tail].join('[\\s_-]*');
}

const compiledCache = new Map<string, RegExp | null>();

function compile(terms: readonly string[]): RegExp | null {
  const key = terms.join('\n');
  if (compiledCache.has(key)) return compiledCache.get(key)!;
  const parts = terms.map((t) => termPattern(fold(t))).filter(Boolean);
  const re = parts.length ? new RegExp(`(?<![a-z])(?:${parts.join('|')})(?![a-z])`) : null;
  if (compiledCache.size >= 16) compiledCache.clear();
  compiledCache.set(key, re);
  return re;
}

/** True when a label names a pest, a disease or a weed: one of
 *  `DIAGNOSIS_WORDS` or one of the library's target names. */
export function namesDiagnosis(label: string, libraryTerms: readonly string[] = []): boolean {
  const words = compile(DIAGNOSIS_WORDS);
  const library = compile(libraryTerms);
  return variants(label).some((v) => !!(words?.test(v) || library?.test(v)));
}

/** True when a `problem` label names a treatment, a fix, an action or a
 *  cause, instead of only what the photo shows. */
export function namesTreatment(label: string): boolean {
  return variants(label).some((v) => TREATMENT_PATTERNS.some((r) => r.test(v)));
}
