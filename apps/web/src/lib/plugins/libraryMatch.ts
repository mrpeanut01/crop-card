/**
 * Deterministic name matching between a scanned or typed product name and
 * library entries (crop categories for seed, product labels for pesticides
 * and fertility). Pure and client-safe: the scan endpoints use it on the
 * server and the inventory form's type-ahead uses it in the browser, so both
 * rank the same way and it works with no AI key (#472).
 */

export interface LibraryOption {
  id: string;
  name: string;
  /** A medicine's NADA or ANADA number, for an approval typed without its word. */
  approval?: { kind: 'NADA' | 'ANADA'; number: string };
}

export interface LibraryMatch extends LibraryOption {
  score: number;
}

const NOISE_WORDS = new Set([
  'a',
  'an',
  'and',
  'bag',
  'bulk',
  'certified',
  'coated',
  'count',
  'ct',
  'f1',
  'f2',
  'film',
  'for',
  'g',
  'gm',
  'gmo',
  'gram',
  'heirloom',
  'hybrid',
  'kg',
  'lb',
  'mix',
  'non',
  'nongmo',
  'of',
  'op',
  'open',
  'organic',
  'oz',
  'pack',
  'packet',
  'pellet',
  'pelleted',
  'pkt',
  'pollinated',
  'raw',
  'seed',
  'the',
  'treated',
  'untreated',
  'usda',
  'variety',
  'with'
]);

/** Common-name synonyms folded onto the word the library uses. Phrases are
 *  replaced before tokenising; single words after. */
const PHRASE_SYNONYMS: ReadonlyArray<[RegExp, string]> = [
  [/\b(pak|pac|bok) ?cho[iy]\b/g, 'bok choy'],
  [/\b(green|spring) onions?\b/g, 'scallion'],
  [/\bsweetcorn\b/g, 'sweet corn'],
  [/\bcorn salad\b/g, 'mache'],
  [/\blamb'?s lettuce\b/g, 'mache'],
  [/\bnon[- ]gmo\b/g, ' ']
];

const WORD_SYNONYMS: Readonly<Record<string, string>> = {
  aubergine: 'eggplant',
  brinjal: 'eggplant',
  courgette: 'zucchini',
  capsicum: 'pepper',
  chili: 'pepper',
  chilli: 'pepper',
  chile: 'pepper',
  coriander: 'cilantro',
  beetroot: 'beet',
  maize: 'corn',
  rocket: 'arugula',
  swede: 'rutabaga',
  muskmelon: 'cantaloupe',
  garbanzo: 'chickpea'
};

function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (/(ches|shes|xes|sses)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

function tokenList(text: string): string[] {
  let s = text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  for (const [re, to] of PHRASE_SYNONYMS) s = s.replace(re, to);
  const out: string[] = [];
  for (const raw of s.split(/[^a-z0-9]+/)) {
    if (!raw || /^\d/.test(raw)) continue;
    const word = singular(WORD_SYNONYMS[raw] ?? raw);
    const mapped = WORD_SYNONYMS[word] ?? word;
    if (NOISE_WORDS.has(raw) || NOISE_WORDS.has(mapped)) continue;
    out.push(mapped);
  }
  return out;
}

/** Normalised word set for a product or crop name: lower case, plurals
 *  folded, synonyms mapped, and pack/marketing words (heirloom, organic,
 *  F1, pelleted, seeds, sizes) removed. */
export function nameTokens(text: string): Set<string> {
  return new Set(tokenList(text));
}

interface EntryTokens {
  core: string[];
  extra: Set<string>;
  head: string | undefined;
}

function entryTokens(name: string): EntryTokens {
  const inParens = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).join(' ');
  const outside = name.replace(/\([^)]*\)/g, ' ');
  const core = [...new Set(tokenList(outside))];
  return { core, extra: nameTokens(inParens), head: core[0] };
}

/** Floor score when the entry's leading word (usually the crop kind, as in
 *  "Tomato - Cherokee Purple") appears in the query. */
const HEAD_MATCH_FLOOR = 0.3;

export const MIN_MATCH_SCORE = 0.3;

/**
 * Rank library entries against a name. Score is shared words over the
 * larger of the two word sets; words in the entry's parentheses only count
 * when they match. An entry whose leading word is in the query scores at
 * least 0.3, so "Mortgage Lifter Beefsteak Tomato" still lands on a tomato.
 */
export function rankLibraryMatches(
  query: string,
  options: ReadonlyArray<LibraryOption>,
  opts: { limit?: number; minScore?: number } = {}
): LibraryMatch[] {
  const limit = opts.limit ?? 3;
  const minScore = opts.minScore ?? MIN_MATCH_SCORE;
  const q = nameTokens(query);
  if (q.size === 0) return [];
  const scored: Array<LibraryMatch & { shared: number; size: number }> = [];
  for (const opt of options) {
    const { core, extra, head } = entryTokens(opt.name);
    let shared = 0;
    for (const t of core) if (q.has(t)) shared++;
    let extraShared = 0;
    for (const t of extra) if (q.has(t) && !core.includes(t)) extraShared++;
    const total = shared + extraShared;
    if (total === 0) continue;
    const size = Math.max(q.size, core.length + extraShared);
    let score = Math.min(1, total / size);
    if (head && q.has(head)) score = Math.max(score, HEAD_MATCH_FLOOR);
    if (score < minScore) continue;
    scored.push({ ...opt, score: Math.round(score * 1000) / 1000, shared: total, size });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score || b.shared - a.shared || a.size - b.size || a.name.localeCompare(b.name)
  );
  return scored.slice(0, limit).map(({ id, name, score }) => ({ id, name, score }));
}

/**
 * Type-ahead filter: every query word must prefix-match some word of the
 * entry (after the same normalisation), ranked by `rankLibraryMatches`
 * score. An empty query returns the list in name order.
 */
export function searchLibrary(
  query: string,
  options: ReadonlyArray<LibraryOption>,
  limit = 8
): LibraryOption[] {
  const raw = query.trim().toLowerCase();
  if (!raw) return [...options].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  const qWords = raw.split(/[^a-z0-9]+/).filter(Boolean);
  const qNorm = tokenList(query);
  const hits: Array<{ opt: LibraryOption; rank: number }> = [];
  for (const opt of options) {
    const plain = opt.name.toLowerCase();
    const words = [...plain.split(/[^a-z0-9]+/).filter(Boolean), ...tokenList(opt.name)];
    const idWords = opt.id.toLowerCase().split('-');
    const all = [...words, ...idWords];
    const ok =
      qWords.every((w) => all.some((x) => x.startsWith(w))) ||
      (qNorm.length > 0 && qNorm.every((w) => all.some((x) => x.startsWith(w))));
    if (!ok) continue;
    const starts = plain.startsWith(raw) ? 1 : 0;
    hits.push({ opt, rank: starts });
  }
  hits.sort((a, b) => b.rank - a.rank || a.opt.name.localeCompare(b.opt.name));
  return hits.slice(0, limit).map((h) => h.opt);
}

/**
 * The one library entry a name clearly means, or undefined. Unlike the top
 * `rankLibraryMatches` hit, it never guesses: every word of the name must be
 * in the entry (at least one outside its parentheses), and when several
 * entries hold all of them, only an entry whose name is exactly those words
 * wins. So "Garlic" or "Tomato" (many varieties), "Blue Lake pole bean" (the
 * library has a bush Blue Lake) and "Lettuce mix" (Miner's Lettuce is a
 * different plant) are left for the operator to pick.
 */
export function confidentLibraryMatch(
  query: string,
  options: ReadonlyArray<LibraryOption>
): LibraryOption | undefined {
  const q = [...nameTokens(query)];
  if (q.length === 0) return undefined;
  const covering: Array<{ opt: LibraryOption; exact: boolean }> = [];
  for (const opt of options) {
    const { core, extra } = entryTokens(opt.name);
    if (!q.some((t) => core.includes(t))) continue;
    if (!q.every((t) => core.includes(t) || extra.has(t))) continue;
    const exact = core.length === q.length && core.every((t) => q.includes(t));
    covering.push({ opt, exact });
  }
  if (covering.length === 1) return covering[0].opt;
  const exact = covering.filter((c) => c.exact);
  return exact.length === 1 ? exact[0].opt : undefined;
}
