/**
 * The no-key shortlist (Phase 37A, R-19). The cuisine and goal tables are
 * the app's own editorial suggestions, not agronomy: they say which herbs
 * a cook usually reaches for, never how a herb grows. Rows from them are
 * tagged `fallback`; herbs the owner asked for are `manual`. The sun answer
 * filters nothing, because no crop plugin says how much sun it needs.
 */

import { isHerbGardenCrop } from '$lib/garden/herbs';
import { t, type MessageKey } from '$lib/i18n';
import {
  MAX_SHORTLIST,
  type BriefAnswers,
  type BriefCuisine,
  type BriefReason,
  type BriefWhy,
  type ShortlistRow
} from './schema';

export const CUISINE_HERBS: Readonly<Record<BriefCuisine, readonly string[]>> = {
  italian: [
    'basil-genovese',
    'oregano-greek',
    'parsley-italian-flat-leaf',
    'rosemary-tuscan-blue',
    'sage-broadleaf',
    'thyme-german-winter'
  ],
  mexican: ['cilantro-santo', 'oregano-greek', 'mint-spearmint'],
  'thai-vietnamese': [
    'tulsi-holy-basil-rama',
    'lemongrass-east-indian',
    'cilantro-santo',
    'mint-spearmint',
    'perilla-shiso-green'
  ],
  french: [
    'tarragon-french',
    'chervil',
    'chives-common',
    'parsley-italian-flat-leaf',
    'thyme-german-winter',
    'marjoram-sweet',
    'summer-savory'
  ],
  'middle-eastern': [
    'parsley-italian-flat-leaf',
    'mint-spearmint',
    'cilantro-santo',
    'dill-mammoth',
    'thyme-german-winter'
  ],
  indian: ['cilantro-santo', 'mint-spearmint', 'lemongrass-east-indian'],
  'tea-drinks': [
    'mint-spearmint',
    'chamomile-german',
    'lemon-balm',
    'lemon-verbena',
    'tulsi-holy-basil-rama',
    'anise-hyssop'
  ]
};

export const WHY_HERBS: Readonly<Record<BriefWhy, readonly string[]>> = {
  cooking: [
    'basil-genovese',
    'parsley-italian-flat-leaf',
    'chives-common',
    'thyme-german-winter',
    'rosemary-tuscan-blue',
    'mint-spearmint'
  ],
  tea: [
    'chamomile-german',
    'mint-spearmint',
    'lemon-balm',
    'lemon-verbena',
    'bergamot-monarda',
    'stevia-sweetleaf'
  ],
  'pollinators-looks': [
    'lavender-english-munstead',
    'anise-hyssop',
    'bergamot-monarda',
    'mountain-mint',
    'calendula-resina',
    'nasturtium-companion'
  ],
  gifts: [
    'lavender-english-munstead',
    'rosemary-tuscan-blue',
    'thyme-german-winter',
    'sage-broadleaf'
  ],
  'save-money': ['basil-genovese', 'cilantro-santo', 'parsley-italian-flat-leaf', 'chives-common'],
  'learn-with-children': [
    'nasturtium-companion',
    'mint-spearmint',
    'chamomile-german',
    'calendula-resina',
    'lemon-balm',
    'stevia-sweetleaf'
  ]
};

/** Cuisines whose rows read "Picked for tea and drinks", not "... cooking". */
const DRINK_CUISINES = new Set<BriefCuisine>(['tea-drinks']);

function joinList(words: readonly string[], locale?: string | null): string {
  if (words.length <= 1) return words[0] ?? '';
  const and = t(locale, 'herbsa.because.and');
  if (words.length === 2) return `${words[0]} ${and} ${words[1]}`;
  return `${words.slice(0, -1).join(', ')} ${and} ${words[words.length - 1]}`;
}

/** The "because" line for a deterministic row, in `locale` (English when
 *  unset, which is also what is stored and sent to Claude). */
export function becauseText(reasons: readonly BriefReason[], locale?: string | null): string {
  const sentences: string[] = [];
  if (reasons.some((r) => r.kind === 'wanted')) sentences.push(t(locale, 'herbsa.because.wanted'));
  const cuisines = reasons
    .flatMap((r) => (r.kind === 'cuisine' && !DRINK_CUISINES.has(r.cuisine) ? [r.cuisine] : []))
    .map((c) => t(locale, `herbsa.cuisineAdj.${c}` as MessageKey));
  if (cuisines.length > 0) {
    sentences.push(t(locale, 'herbsa.because.cuisine', { cuisines: joinList(cuisines, locale) }));
  }
  const drinks =
    reasons.some((r) => r.kind === 'cuisine' && DRINK_CUISINES.has(r.cuisine)) ||
    reasons.some((r) => r.kind === 'why' && r.why === 'tea');
  if (drinks) sentences.push(t(locale, 'herbsa.because.why.tea'));
  for (const r of reasons) {
    if (r.kind === 'why' && r.why !== 'tea') {
      sentences.push(t(locale, `herbsa.because.why.${r.why}` as MessageKey));
    }
  }
  if (sentences.length === 0) sentences.push(t(locale, 'herbsa.because.suggested'));
  return sentences.join(' ');
}

/** Every reason the tables give a herb for these answers. */
export function reasonsFor(pluginId: string, answers: BriefAnswers): BriefReason[] {
  const out: BriefReason[] = [];
  if ((answers.wanted?.value ?? []).includes(pluginId)) out.push({ kind: 'wanted' });
  for (const cuisine of answers.cuisines?.value ?? []) {
    if (CUISINE_HERBS[cuisine].includes(pluginId)) out.push({ kind: 'cuisine', cuisine });
  }
  for (const why of answers.why?.value ?? []) {
    if (WHY_HERBS[why].includes(pluginId)) out.push({ kind: 'why', why });
  }
  return out;
}

/** The deterministic reason for one herb, used when Claude's sentence for
 *  it fails the spray-advice guard (R-26), so a row never loses its line. */
export function deterministicReason(
  pluginId: string,
  answers: BriefAnswers
): { reasons: BriefReason[]; because: string } {
  const found = reasonsFor(pluginId, answers);
  const reasons: BriefReason[] = found.length > 0 ? found : [{ kind: 'suggested' }];
  return { reasons, because: becauseText(reasons) };
}

export interface DeterministicShortlist {
  rows: ShortlistRow[];
  /** The sun answer was half a day or shade. It filters nothing; the page
   *  says the list is not sorted by sun. */
  sunWarning: boolean;
}

/** The shortlist from the answers alone. `known` drops ids the farm's
 *  library does not hold (a farm copy can retire a plugin). */
export function deterministicShortlist(
  answers: BriefAnswers,
  known: (pluginId: string) => boolean = () => true
): DeterministicShortlist {
  const avoid = new Set(answers.avoid?.value ?? []);
  const usable = (id: string) => isHerbGardenCrop(id) && known(id) && !avoid.has(id);
  const order: string[] = [];
  const add = (id: string) => {
    if (usable(id) && !order.includes(id)) order.push(id);
  };
  for (const id of answers.wanted?.value ?? []) add(id);
  for (const cuisine of answers.cuisines?.value ?? []) CUISINE_HERBS[cuisine].forEach(add);
  for (const why of answers.why?.value ?? []) WHY_HERBS[why].forEach(add);

  const ranked = order
    .map((id, i) => ({ id, i, reasons: reasonsFor(id, answers) }))
    .sort((a, b) => {
      const wa = a.reasons.some((r) => r.kind === 'wanted') ? 1 : 0;
      const wb = b.reasons.some((r) => r.kind === 'wanted') ? 1 : 0;
      return wb - wa || b.reasons.length - a.reasons.length || a.i - b.i;
    })
    .slice(0, MAX_SHORTLIST);

  const sun = answers.sun?.value ?? null;
  return {
    rows: ranked.map(({ id, reasons }) => ({
      cropPluginId: id,
      because: becauseText(reasons),
      provenance: reasons.some((r) => r.kind === 'wanted') ? 'manual' : 'fallback',
      reasons
    })),
    sunWarning: sun === 'half-day' || sun === 'shade'
  };
}

/** Every English sentence the tables can produce, for the guard test. */
export function allDeterministicBecauseLines(): string[] {
  const lines = new Set<string>();
  for (const cuisine of Object.keys(CUISINE_HERBS) as BriefCuisine[]) {
    lines.add(becauseText([{ kind: 'cuisine', cuisine }]));
  }
  for (const why of Object.keys(WHY_HERBS) as BriefWhy[]) {
    lines.add(becauseText([{ kind: 'why', why }]));
  }
  lines.add(becauseText([{ kind: 'wanted' }]));
  lines.add(becauseText([{ kind: 'suggested' }]));
  return [...lines];
}
