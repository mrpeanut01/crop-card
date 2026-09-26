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
    .map((s) => ({ title: s.title, items: [...s.items] }));
  if (found.length) return found;
  return [{ title: 'Care guide', items: [NO_SECTION_TEXT[topic]] }];
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
    'weed ?killer',
    'bug ?killer',
    'neem',
    'copper (?:fungicide|soap|hydroxide|sulfate|octanoate|spray)',
    '(?:wettable |dusting )?sulfur (?:dust|spray|fungicide)',
    'wettable sulfur',
    'spinosad',
    'bacillus thuringiensis',
    'b\\.?t\\.?k?',
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

const RATE_PATTERN =
  /\b\d+(?:\.\d+)?\s*(?:fl\.?\s*oz|oz|ounces?|ml|milliliters?|tbsp|tablespoons?|tsp|teaspoons?|lbs?|pounds?|pints?|pt|quarts?|qt|gallons?|gal|grams?|g)\s*(?:per|\/|a|an|each)\s*(?:gallon|gal|acre|ac|liter|litre|l|1,?000)/i;

/** True when a sentence names a pesticide, a spray, or a mix rate. */
export function isSprayAdvice(sentence: string): boolean {
  return PESTICIDE_TERMS.test(sentence) || RATE_PATTERN.test(sentence);
}

/** True when the grower's own question asks for spray or product advice. */
export function asksForSprayAdvice(question: string): boolean {
  return (
    isSprayAdvice(question) ||
    /\b(what|which) (?:product|chemical)s?\b/i.test(question) ||
    /\bhow much\b.*\b(?:mix|per gallon|per acre)\b/i.test(question)
  );
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
export function filterSprayAdvice(text: string): { text: string; removed: boolean } {
  const all = sentences(text);
  const kept = all.filter((s) => !isSprayAdvice(s));
  return { text: kept.join(' '), removed: kept.length !== all.length };
}

export function filterSprayAdviceItems(items: readonly string[]): string[] {
  return items.filter((i) => !isSprayAdvice(i));
}
