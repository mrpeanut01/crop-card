/** Close-out CO-5: a shortlist herb's sourced sun need against the owner's
 *  sun answer. Sun only orders rows (match, then unknown, then mismatch) and
 *  adds a line; it never removes or filters a row, so a herb the owner typed
 *  always stays. Client-safe. With no locale every helper returns English. */

import { t } from '$lib/i18n';
import type { BriefSun } from './schema';

export type HerbSunNeed = 'full' | 'part' | 'shade';
export type SunFit = 'match' | 'unknown' | 'mismatch';

const SHADE_ORDER: Record<HerbSunNeed, number> = { full: 0, part: 1, shade: 2 };
/** The most shade an answer's spot gives, on the same scale. */
const ANSWER_SHADE: Record<BriefSun, number> = { full: 0, 'half-day': 1, shade: 2 };

/** True when the spot gets less than full sun (the page's sun note shows). */
export function sunIsLimited(answer: BriefSun | null | undefined): boolean {
  return answer === 'half-day' || answer === 'shade';
}

/** `mismatch` when the herb wants more sun than the spot gets; `unknown`
 *  when no source says; otherwise `match`. With no answer every known herb
 *  matches. */
export function sunFit(
  need: HerbSunNeed | null | undefined,
  answer: BriefSun | null | undefined
): SunFit {
  if (!need) return 'unknown';
  if (!answer) return 'match';
  return SHADE_ORDER[need] < ANSWER_SHADE[answer] ? 'mismatch' : 'match';
}

const FIT_ORDER: Record<SunFit, number> = { match: 0, unknown: 1, mismatch: 2 };

/** Rows in the same set, reordered match, then unknown, then mismatch, when
 *  the spot gets less than full sun; otherwise as given. Stable. */
export function orderBySun<T extends { cropPluginId: string }>(
  rows: readonly T[],
  answer: BriefSun | null | undefined,
  needOf: (pluginId: string) => HerbSunNeed | null | undefined
): T[] {
  if (!sunIsLimited(answer)) return [...rows];
  return rows
    .map((row, i) => ({ row, i, fit: FIT_ORDER[sunFit(needOf(row.cropPluginId), answer)] }))
    .sort((a, b) => a.fit - b.fit || a.i - b.i)
    .map((x) => x.row);
}

/** The row's sun line, or null when no source says: "Wants full sun.",
 *  "Takes part shade." or "Grows in shade.", or the mismatch wording when
 *  the herb wants more sun than the spot gets. */
export function sunLine(
  need: HerbSunNeed | null | undefined,
  answer: BriefSun | null | undefined,
  locale?: string | null
): string | null {
  if (!need) return null;
  if (sunFit(need, answer) === 'mismatch') {
    return need === 'full'
      ? t(locale, 'herbsa.sun.mismatch.full')
      : t(locale, 'herbsa.sun.mismatch.part');
  }
  return t(locale, `herbsa.sun.${need}`);
}

/** The prompt's words for a herb's sun need (always English). */
export const SUN_NEED_PROMPT_WORDS: Readonly<Record<HerbSunNeed, string>> = {
  full: 'wants full sun',
  part: 'takes part shade',
  shade: 'grows in shade'
};
