/** Photo help rules shared by the endpoint and the offline panel: which
 *  Care Guide section answers which question, and the guard that keeps
 *  pesticide product, rate and spray-timing advice out of every answer. */

import type { JournalAnswerSection, PhotoQuestion } from './model';

export type CareTopic = 'harvest' | 'prune' | 'problems' | 'general';

export const CARE_SECTION = {
  water: 'Water',
  feed: 'Feed',
  prune: 'Stake and prune',
  harvest: 'Harvest cues',
  problems: 'Common problems',
  notes: 'Notes'
} as const;

const TOPIC_SECTIONS: Record<CareTopic, readonly string[]> = {
  harvest: [CARE_SECTION.harvest],
  prune: [CARE_SECTION.prune],
  problems: [CARE_SECTION.problems],
  general: [CARE_SECTION.harvest, CARE_SECTION.problems, CARE_SECTION.water]
};

const HARVEST_WORDS = /\b(ripe|ready|pick|picking|harvest|mature|done)\b/i;
const PRUNE_WORDS = /\b(prun\w*|sucker\w*|stak\w*|trim\w*|cut back|pinch\w*|thin\w*|trellis\w*)\b/i;
const PROBLEM_WORDS =
  /\b(leaf|leaves|spot\w*|yellow\w*|brown\w*|wilt\w*|hole\w*|bug\w*|pest\w*|curl\w*|mold\w*|mildew|rot\w*|sick|disease\w*|wrong)\b/i;

export function topicFor(question: PhotoQuestion, text = ''): CareTopic {
  if (question === 'ready') return 'harvest';
  if (question === 'prune') return 'prune';
  if (question === 'leaves') return 'problems';
  if (PROBLEM_WORDS.test(text)) return 'problems';
  if (PRUNE_WORDS.test(text)) return 'prune';
  if (HARVEST_WORDS.test(text)) return 'harvest';
  return 'general';
}

export const NO_SECTION_TEXT: Record<CareTopic, string> = {
  harvest: 'This crop has no harvest cues yet. Count days from planting and check the seed packet.',
  prune: 'This crop has no pruning steps yet. Most plants only need dead or damaged parts removed.',
  problems:
    'This crop has no common problems listed yet. Take a close photo of both sides of a leaf and compare it next week.',
  general: 'This crop has no growing guide yet. Check the seed packet for the basics.'
};

/** The Care Guide sections that answer a topic, or one plain line when the
 *  guide has none of them. */
export function careSectionsFor(
  sections: readonly JournalAnswerSection[],
  topic: CareTopic
): JournalAnswerSection[] {
  const wanted = TOPIC_SECTIONS[topic];
  const found = wanted
    .map((title) => sections.find((s) => s.title === title))
    .filter((s): s is JournalAnswerSection => !!s && s.items.length > 0)
    .map((s) => ({
      title: s.title,
      items: [...s.items],
      ...(s.provenance ? { provenance: s.provenance } : {})
    }));
  if (found.length) return found;
  return [{ title: 'Care guide', items: [NO_SECTION_TEXT[topic]], provenance: 'fallback' }];
}

export const SPRAY_REDIRECT =
  'For anything you would spray, use the Spray flow and follow the product label. The label has the rate, the timing and the safety steps.';

const PESTICIDE_TERMS = new RegExp(
  [
    'spray\\w*',
    'spr[ae]y[ei]?\\w*',
    'spary\\w*',
    'pesti?[cs]i?de?\\w*',
    'insecti?[cs]i?de?\\w*',
    'fungi?c[iy]?de?\\w*',
    'fongicide\\w*',
    'herbi?[cs]i?de?\\w*',
    'pulv[eé]ris\\w*',
    'pulveriz\\w*',
    'roci[ae]r\\w*',
    'fumig\\w*',
    'pesticid\\w*',
    'insecticid\\w*',
    'fungicid\\w*',
    'herbicid\\w*',
    'miticid\\w*',
    'bactericid\\w*',
    'nematicid\\w*',
    'weed ?killer',
    'bug ?killer',
    'neem',
    'baking soda',
    'bicarbonate',
    'hydrogen peroxide',
    'bordeaux',
    'milk (?:spray|solution|mix)',
    'garlic (?:water|spray|oil|tea)',
    '(?:cayenne|hot)? ?pepper (?:spray|tea|wax)',
    'bonide',
    'captain jack',
    'monterey',
    'garden safe',
    'safer brand',
    'ortho\\b',
    'spectracide',
    'bioadvanced',
    'bayer advanced',
    'southern ag',
    'ferti-?lome',
    'hi-?yield',
    'natria',
    'dr\\.? earth',
    'bravo\\b',
    'active ingredients?',
    'mode of action',
    'frac\\b',
    'irac\\b',
    'hrac\\b',
    'capfuls?',
    'ppm\\b',
    'parts per million',
    'copper(?![- ](?:colou?red|toned|brown|tint))',
    'sulfur',
    'sulphur',
    'diatomaceous',
    'kaolin',
    'soap (?:solution|mix|water)',
    'soapy water',
    'dish soap',
    'bacillus',
    'oil spray',
    'products?\\b',
    'spinosad',
    'b\\.?t\\.?k?\\b',
    'pyrethr\\w*',
    'permethrin',
    'bifenthrin',
    'cypermethrin',
    'carbaryl',
    'sevin',
    'malathion',
    'imidacloprid',
    'acetamiprid',
    'chlorothalonil',
    'daconil',
    'mancozeb',
    'captan',
    'myclobutanil',
    'azoxystrobin',
    'glyphosate',
    'roundup',
    'dicamba',
    '2,4-d',
    'insecticidal soap',
    'horticultural oil',
    'dormant oil',
    'rei\\b',
    're[- ]?entry interval',
    'pre[- ]?harvest interval',
    'phi\\b'
  ]
    .map((t) => `\\b${t}`)
    .join('|'),
  'i'
);

const VOLUME_UNITS =
  'fl\\.?\\s*oz|oz|ounces?|ml|milliliters?|tbsp|tablespoons?|tsp|teaspoons?|lbs?|pounds?|pints?|pt|quarts?|qt|gallons?|gal|grams?|g|cups?|liters?|litres?|l|onzas?|onces?|cucharad(?:it)?as?|cuill[eè]res?|litros?|gramos?|grammes?';
const PER_UNITS =
  'gallon|gal|gal[oó]n|acre|ac|liter|litre|litro|l|1,?000|quart|qt|pint|pt|cup|hect[aá]re|hectar[eé]a|ha';
const CONTAINERS = 'gallons?|quarts?|liters?|litres?|pints?|cups?';

const RATE_PATTERNS = [
  new RegExp(
    `\\b\\d+(?:\\.\\d+)?\\s*(?:${VOLUME_UNITS})\\b.{0,40}?\\b(?:per|\\/|a|an|each|par|por|pro)\\s*(?:${PER_UNITS})\\b`,
    'i'
  ),
  new RegExp(
    `\\b(?:\\d+(?:\\.\\d+)?|a|one|two|three|half an?)\\s*(?:${VOLUME_UNITS})\\b.{0,40}?\\b(?:in|to|into|with)\\s+(?:a|one|each|every|\\d+)\\s+(?:${CONTAINERS})\\b`,
    'i'
  ),
  new RegExp(
    `\\bmix\\b.{0,60}\\b(?:in|into|with)\\s+(?:a|one|each|every)\\s+(?:${CONTAINERS})\\b`,
    'i'
  ),
  /\b(?:\d+(?:\.\d+)?|a|one|half an?)\s*(?:tbsp|tablespoons?|tsp|teaspoons?|ml|fl\.?\s*oz|ounces?|oz)\b.{0,40}\bwater\b/i
];

/** Spray timing with the product left out: "apply every 7 days", "re-apply
 *  after rain", "treat weekly while it stays wet". */
const TIMING_PATTERNS = [
  /\b(?:re-?appl\w*|appl(?:y|ies|ied|ying|ication)|treat\w*|dust\w*|drench\w*|fog\w*|mist\w*)\b.{0,50}\b(?:every|each)\s+(?:\d+|few|other|one|two|three|seven|ten|week|7|10|14)\b/i,
  /\b(?:re-?appl\w*|appl(?:y|ies|ied|ying|ication)|treat\w*|dust\w*)\b.{0,50}\b(?:weekly|biweekly|fortnightly|after (?:each |every )?rain|before (?:bloom|rain|bud|harvest)|at (?:dusk|dawn|first sign)|preventat?ive(?:ly)?|protectant)\b/i,
  /\b(?:preventat?ive(?:ly)?|protectant)\b.{0,30}\b(?:appl\w*|treat\w*|cover)\b/i,
  /\b(?:days?|hours?)\b.{0,20}\bbefore (?:harvest|picking|you pick)\b.{0,40}\b(?:appl\w*|treat\w*|dust\w*)\b/i
];

const PEST_WORDS =
  '(?:bugs?|pests?|beetles?|worms?|armyworms?|aphids?|caterpillars?|mites?|slugs?|snails?|borers?|hornworms?|flies|thrips|weeds?|fungus|fungal|mold|mould|mildew|blight|rot|disease|infestation)';

const QUESTION_PATTERNS = [
  /\b(?:what|which) (?:product|chemical)s?\b/i,
  /\bhow much\b.*\b(?:mix|per gallon|per acre)\b/i,
  /\b(?:kill|get rid of|exterminate|wipe out)\b/i,
  /\btreat\b.{0,40}\bwith\b/i,
  /\bwhat (?:can|should|do) i (?:put|spray|apply|treat|dust)\b/i,
  new RegExp(
    `\\b(?:put|use|apply|dust)\\b.{0,40}\\b(?:on|for|against)\\b.{0,20}\\b${PEST_WORDS}`,
    'i'
  ),
  /\b(?:what|which)\b.{0,40}\b(?:rate|dose|dosage|how much)\b/i,
  /\bapplication rate\b/i,
  /\bhow (?:much|many)\b.{0,30}\bper (?:gallon|acre|quart|liter|litre)\b/i,
  /\bwhat (?:do|does|would|will)\b.{0,30}\b(?:farms?|farmers?|growers?|pros?|professionals?|orchards?|extension|agents?|nurser(?:y|ies)|stores?)\b.{0,30}\b(?:put|use|apply|recommend|spray|dust)\w*\b/i,
  /\btreatments?\b/i,
  /\btreat(?:ing)? (?:it|this|these|them|the (?:leaves|plants?|spots?|bed))\b/i,
  /\b(?:medicine|remed(?:y|ies)|repellents?|deterrents?)\b/i,
  /\bcure (?:it|this|the|these)\b.{0,20}\b(?:disease|blight|mildew|fung\w*|rot|spots?|infection)\b/i,
  /\b(?:something|anything)\b.{0,25}\b(?:put|buy|use|apply|spray|dust|give)\b/i,
  /\b(?:what|which)\b.{0,30}\b(?:apply|applying|use|using)\b.{0,30}\b(?:preventat?ive(?:ly)?|this time of year|now|protect\w*)\b/i,
  /\bpreventat?ive(?:ly)?\b/i,
  /\b(?:schedule|every (?:week|\d+ days?|few days|other week)|how often|how many times)\b.{0,50}\b(?:protect\w*|treat\w*|appl\w*|dust\w*)\b/i,
  /\b(?:protect\w*|treat\w*|appl\w*|dust\w*)\b.{0,50}\b(?:schedule|every (?:week|\d+ days?|few days|other week)|how often|weekly)\b/i,
  /\b(?:safe to|ok to|okay to) (?:put|use|apply|dust)\b/i,
  /\bput on\b.{0,50}\bhow much\b/i,
  /\b(?:ratio|dilut\w*|concentration|strength)\b/i,
  /\bhow much\s+\w+(?:\s+\w+)?\s+(?:to|in|per|into)\s+(?:\w+\s+)?water\b/i,
  /\brecipe\b.{0,40}\b(?:bugs?|pests?|repel\w*|mildew|fung\w*|blight|aphids?|beetles?|mixture|mix)\b/i,
  /\b(?:homemade|home-made|diy)\b.{0,30}\b(?:mix\w*|bug|pest|repel\w*|fung\w*|killer)\b/i,
  /\b(?:days?|how long)\b.{0,30}\bbefore (?:harvest|picking|i pick)\b/i,
  /\b(?:dose|dosis|dosage|quel produit|qu[eé] producto|welches mittel)\b/i,
  /\bhow many (?:tablespoons?|teaspoons?|ounces?|oz|ml|cups?)\b/i,
  /\b(?:watering can|tank|sprayer|pump|backpack)\b.{0,40}\b(?:how much|what goes|put in|add|mix)\b/i,
  /\b(?:what goes|put|add|mix)\b.{0,30}\b(?:in|into) (?:my|the|a|your) (?:watering can|tank|sprayer|pump|backpack)\b/i,
  /\b(?:pour|sprinkle|dip|paint|drench|coat|wet|dust|rub|wipe)\w*\b.{0,40}\b(?:with (?:something|anything|what)|what\b|something|anything)/i,
  /\bwhat\b.{0,30}\b(?:pour|sprinkle|dip|paint|drench|coat|rub|wipe)\b/i,
  /\bwith (?:something|anything)\b/i,
  new RegExp(
    `\\b(?:sold|buy|bought|purchase)\\b.{0,40}\\b(?:for|to (?:kill|stop|control|prevent))\\b.{0,20}\\b(?:${PEST_WORDS}|spots?)`,
    'i'
  ),
  /\b(?:home depot|lowe'?s|tractor supply|walmart|amazon|garden (?:center|centre)|feed store|hardware store)\b/i,
  /\b(?:specific|exact)\b.{0,20}\bamounts?\b/i,
  /\bwhat(?:'s| is) the (?:[a-z]) one\b/i,
  /\bqu[eé] (?:le |les |lui )?(?:echo|pongo|aplico|mettre|appliquer)\b/i
];

/** The question with leetspeak and letter-by-letter spelling undone, so
 *  "sp_r_a_y" and "n-e-e-m" meet the same patterns as the plain words. */
export function normalizeQuestion(question: string): string {
  return question
    .replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[0]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/[5$]/g, 's')
    .replace(/\b(?:[a-z][\s_.*\-]+){2,}[a-z]\b/gi, (m) => m.replace(/[\s_.*\-]+/g, ''))
    .replace(/([a-z])[_*]+(?=[a-z])/gi, '$1');
}

const COMMON_WORD_BRANDS = new Set(
  (
    'accent aim anthem apollo authority beyond bravo cease champ classic closer command confirm ' +
    'corn deadline double dual elevate flint forum fulfill harmony headline inspire liberty method ' +
    'omega outlook permit portal pursuit rally reflex sharpen suppress surround switch tilt ' +
    'touchdown trilogy trust valor verdict warrant weed wettable'
  ).split(' ')
);

const ENGLISH_WORD_BRANDS = new Set(
  (
    'admire applaud asana assail belay brigade cadet chaparral cobra crossbow endura entrust ' +
    'fierce howler intrepid javelin mustang oberon presidio pristine prowl radiant raptor ' +
    'serenade spartan stinger venerate warrior'
  ).split(' ')
);

const FORMULATION_TOKEN =
  /^(?:\d[\w.%-]*|[A-Z]{1,4}\d*|[A-Z]+\d+[A-Z]*|eVo|EVO|Plus|Pro|Prime|Max|MAXX|Maxx|Ultra|ULTRA|II|Edge|Opti|Flex|Extra|Super|Gold|Charge|Xpress|Stik|Weather|with|Zeon)$/;

const AI_TAIL =
  /\s+(?:strain|isolate|infective|heat-killed|parasitized|calcium complex|dimethylamine|choline|bapma|dma|ipa|potassium salt|sodium salt|salts?|2-ethylhexyl|butoxyethyl|hydrochloride|extract)\b.*$/i;

export interface SprayTermSource {
  displayName: string;
  activeIngredients?: readonly string[];
}

/** Brand names and active ingredients from the pesticide plugin library,
 *  for `isSprayAdvice`. A leading `^` marks a brand that is also an English
 *  word: it matches only capitalized. A leading `=` marks an everyday word:
 *  it matches only capitalized and mid-sentence. */
export function sprayProductTerms(products: readonly SprayTermSource[]): string[] {
  const terms = new Set<string>();
  const add = (t: string) => {
    if (t.length < 4) return;
    const lower = t.toLowerCase();
    if (COMMON_WORD_BRANDS.has(lower)) terms.add(`=${t}`);
    else if (ENGLISH_WORD_BRANDS.has(lower)) terms.add(`^${t}`);
    else terms.add(lower);
  };
  for (const p of products) {
    const head = p.displayName.split(/\s+\(|\s+—\s+/)[0] ?? '';
    for (const part of head.split(/\s*\/\s*/)) {
      const brand = part.replace(/\s+/g, ' ').trim();
      const tokens = brand.split(' ').filter((t) => t && !FORMULATION_TOKEN.test(t));
      if (brand.includes(' ')) add(brand);
      add(tokens.join(' '));
      add(tokens[0] ?? '');
    }
    for (const ai of p.activeIngredients ?? []) {
      const name = ai
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(AI_TAIL, '')
        .trim()
        .toLowerCase();
      if (name.length >= 4) terms.add(name);
    }
  }
  return [...terms].sort();
}

interface CompiledTerms {
  plain: RegExp | null;
  capitalized: RegExp | null;
}

const compiledCache = new Map<string, CompiledTerms>();

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileTerms(terms: readonly string[] | undefined): CompiledTerms {
  if (!terms?.length) return { plain: null, capitalized: null };
  const cacheKey = terms.join('\n');
  const hit = compiledCache.get(cacheKey);
  if (hit) return hit;
  const plain: string[] = [];
  const caps: string[] = [];
  const midCaps: string[] = [];
  for (const t of terms) {
    if (t.startsWith('=')) midCaps.push(escapeRe(t.slice(1)));
    else if (t.startsWith('^')) caps.push(escapeRe(t.slice(1)));
    else if (t) plain.push(escapeRe(t));
  }
  const bounded = (list: string[]) => `(?<![\\w-])(?:${list.join('|')})(?![\\w-])`;
  const capParts = [
    ...(caps.length ? [bounded(caps)] : []),
    ...(midCaps.length ? [`(?<=[^.!?\\s]\\s+)${bounded(midCaps)}`] : [])
  ];
  const compiled: CompiledTerms = {
    plain: plain.length ? new RegExp(bounded(plain), 'i') : null,
    capitalized: capParts.length ? new RegExp(capParts.join('|')) : null
  };
  if (compiledCache.size >= 16) compiledCache.clear();
  compiledCache.set(cacheKey, compiled);
  return compiled;
}

/** True when a sentence names a pesticide, a spray, or a mix rate. Pass the
 *  library's `sprayProductTerms` so brand names are caught too. */
export function isSprayAdvice(sentence: string, terms?: readonly string[]): boolean {
  if (
    PESTICIDE_TERMS.test(sentence) ||
    RATE_PATTERNS.some((r) => r.test(sentence)) ||
    TIMING_PATTERNS.some((r) => r.test(sentence))
  )
    return true;
  const compiled = compileTerms(terms);
  return !!(compiled.plain?.test(sentence) || compiled.capitalized?.test(sentence));
}

/** True when the grower's own question asks for spray or product advice. */
export function asksForSprayAdvice(question: string, terms?: readonly string[]): boolean {
  const variants = [question, normalizeQuestion(question)];
  return variants.some((q) => isSprayAdvice(q, terms) || QUESTION_PATTERNS.some((r) => r.test(q)));
}

const AUTHOR_NOTE = /\bPhase \d+|\btrait override\b|\bfamily-kill\b|\bdefault\b/i;

/** A text split into the sentences the spray filter works on. */
export function answerSentences(text: string): string[] {
  return sentences(text);
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Drops every sentence that gives spray advice. `removed` is true when any
 *  sentence went, so the caller adds the Spray flow redirect. */
export function filterSprayAdvice(
  text: string,
  terms?: readonly string[]
): { text: string; removed: boolean } {
  const all = sentences(text);
  const kept = all.filter((s) => !isSprayAdvice(s, terms));
  return { text: kept.join(' '), removed: kept.length !== all.length };
}

/** Filters each item sentence by sentence and drops items left empty. */
export function filterSprayAdviceItems(
  items: readonly string[],
  terms?: readonly string[]
): string[] {
  return items.map((i) => filterSprayAdvice(i, terms).text).filter((i) => i.length > 0);
}

/** Plugin text shown to a grower or handed to Claude: no spray advice and
 *  no notes meant for plugin authors. Empty when nothing is left. */
export function growerFacingText(text: string, terms?: readonly string[]): string {
  return sentences(text)
    .filter((s) => !isSprayAdvice(s, terms) && !AUTHOR_NOTE.test(s))
    .join(' ');
}
