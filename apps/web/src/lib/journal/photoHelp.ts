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
    're-?entry interval',
    'pre-?harvest interval',
    'phi\\b'
  ]
    .map((t) => `\\b${t}`)
    .join('|'),
  'i'
);

const VOLUME_UNITS =
  'fl\\.?\\s*oz|oz|ounces?|ml|milliliters?|tbsp|tablespoons?|tsp|teaspoons?|lbs?|pounds?|pints?|pt|quarts?|qt|gallons?|gal|grams?|g|cups?|liters?|litres?|l';
const PER_UNITS = 'gallon|gal|acre|ac|liter|litre|l|1,?000|quart|qt|pint|pt|cup';
const CONTAINERS = 'gallons?|quarts?|liters?|litres?|pints?|cups?';

const RATE_PATTERNS = [
  new RegExp(
    `\\b\\d+(?:\\.\\d+)?\\s*(?:${VOLUME_UNITS})\\b.{0,40}?\\b(?:per|\\/|a|an|each)\\s*(?:${PER_UNITS})\\b`,
    'i'
  ),
  new RegExp(
    `\\b(?:\\d+(?:\\.\\d+)?|a|one|two|three|half an?)\\s*(?:${VOLUME_UNITS})\\b.{0,40}?\\b(?:in|to|into|with)\\s+(?:a|one|each|every|\\d+)\\s+(?:${CONTAINERS})\\b`,
    'i'
  ),
  new RegExp(
    `\\bmix\\b.{0,60}\\b(?:in|into|with)\\s+(?:a|one|each|every)\\s+(?:${CONTAINERS})\\b`,
    'i'
  )
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
  /\bhow (?:much|many)\b.{0,30}\bper (?:gallon|acre|quart|liter|litre)\b/i
];

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
  if (PESTICIDE_TERMS.test(sentence) || RATE_PATTERNS.some((r) => r.test(sentence))) return true;
  const compiled = compileTerms(terms);
  return !!(compiled.plain?.test(sentence) || compiled.capitalized?.test(sentence));
}

/** True when the grower's own question asks for spray or product advice. */
export function asksForSprayAdvice(question: string, terms?: readonly string[]): boolean {
  return isSprayAdvice(question, terms) || QUESTION_PATTERNS.some((r) => r.test(question));
}

const AUTHOR_NOTE = /\bPhase \d+|\btrait override\b|\bfamily-kill\b|\bdefault\b/i;

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
