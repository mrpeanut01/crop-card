import type { CareTip } from './careTips';

export interface CareTipSource {
  tip?: string;
  url?: string | null;
  publisher?: string | null;
  date?: string | null;
  quote?: string | null;
  verdict?: string;
  suggestedText?: string;
  note?: string;
  shipped?: string | null;
}

export type CareTipSourceMap = Readonly<Record<string, CareTipSource | string>>;

const SHIPPABLE_VERDICTS = new Set(['supported', 'partly']);
const ELLIPSIS = /\.\.\.|…/;

/** Tips that shipped on a `partly` verdict before Phase 37F (R-20). Every
 *  new tip needs `supported`; this list may only shrink, and an id on it
 *  that no longer ships a `partly` tip is a problem. */
export const PARTLY_GRANDFATHERED_TIP_IDS: ReadonlySet<string> = new Set([
  'solanaceae.water.0',
  'solanaceae.feed.0',
  'solanaceae.problems.0',
  'solanaceae.problems.1',
  'solanaceae.problems.2',
  'cucurbit.water.0',
  'cucurbit.feed.0',
  'cucurbit.problems.2',
  'brassica.water.0',
  'brassica.feed.1',
  'brassica.problems.2',
  'allium.water.0',
  'allium.feed.0',
  'allium.problems.0',
  'allium.problems.1',
  'leafy-green.water.0',
  'leafy-green.prune.0',
  'leafy-green.problems.0',
  'leafy-green.problems.1',
  'root.problems.0',
  'apiaceae.problems.0',
  'legume.feed.0',
  'legume.prune.0',
  'herb-culinary.water.0',
  'herb-culinary.problems.0',
  'small-fruit.water.1',
  'small-fruit.prune.1',
  'bramble.prune.0',
  'vine-fruit.prune.0',
  'stone-fruit.feed.0',
  'stone-fruit.prune.1',
  'orchard.feed.0',
  'orchard.prune.0',
  'orchard.prune.1'
]);

/** A care tip's source is an extension or government page (.edu or .gov). */
export function isAllowedCareTipSource(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host.endsWith('.edu') || host.endsWith('.gov');
}

function filled(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Why a source entry cannot back a shipped tip, or null when it can. */
export function careTipIneligibility(entry: CareTipSource): string | null {
  for (const field of ['url', 'publisher', 'date', 'quote'] as const) {
    if (!filled(entry[field])) return `no ${field}`;
  }
  if (!entry.verdict || !SHIPPABLE_VERDICTS.has(entry.verdict)) {
    return `verdict is ${entry.verdict ?? 'missing'}`;
  }
  if (ELLIPSIS.test(entry.quote as string)) return 'quote is abridged with an ellipsis';
  return null;
}

/** Every way the shown care tips and the research file disagree. Empty means
 *  each tip on screen is the exact text a person checked against a quote. */
export function careTipSourceProblems(
  tips: readonly CareTip[],
  sources: CareTipSourceMap,
  grandfathered: ReadonlySet<string> = PARTLY_GRANDFATHERED_TIP_IDS
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const tip of tips) {
    if (seen.has(tip.id)) {
      problems.push(`${tip.id}: two tips share this id`);
      continue;
    }
    seen.add(tip.id);
    const entry = sources[tip.id];
    if (!entry || typeof entry !== 'object') {
      problems.push(`${tip.id}: no source entry`);
      continue;
    }
    const why = careTipIneligibility(entry);
    if (why) problems.push(`${tip.id}: source cannot back a tip (${why})`);
    if (!why && !isAllowedCareTipSource(entry.url as string)) {
      problems.push(`${tip.id}: source is not an extension or government page`);
    }
    if (!why && entry.verdict === 'partly' && !grandfathered.has(tip.id)) {
      problems.push(`${tip.id}: a new tip needs a supported verdict`);
    }
    if (entry.shipped !== tip.text) {
      problems.push(`${tip.id}: shipped text differs from the tip`);
    }
  }
  for (const [id, entry] of Object.entries(sources)) {
    if (id.startsWith('$') || typeof entry !== 'object' || entry === null) continue;
    if (!('shipped' in entry)) {
      problems.push(`${id}: entry has no shipped field`);
    } else if (entry.shipped !== null && !seen.has(id)) {
      problems.push(`${id}: shipped text has no tip`);
    }
  }
  return problems;
}

/** Grandfathered ids that no longer ship a `partly` tip, so the list can
 *  only shrink. */
export function staleGrandfatheredTips(
  tips: readonly CareTip[],
  sources: CareTipSourceMap,
  grandfathered: ReadonlySet<string> = PARTLY_GRANDFATHERED_TIP_IDS
): string[] {
  const shown = new Set(tips.map((t) => t.id));
  return [...grandfathered].filter((id) => {
    const entry = sources[id];
    return !(
      shown.has(id) &&
      typeof entry === 'object' &&
      entry !== null &&
      entry.verdict === 'partly'
    );
  });
}
