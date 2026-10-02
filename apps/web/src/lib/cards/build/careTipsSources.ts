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
  sources: CareTipSourceMap
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
