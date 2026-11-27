/**
 * Plain sentences for Find a spot, for someone who has never gardened.
 * Client-safe. Without a locale every helper returns English. The words
 * describe the place only: no feeding, liming or product advice.
 */

import { t, type MessageKey } from '$lib/i18n';
import { formatQuantity, type Prefs } from '$lib/prefs';
import { soilSitingFlagText } from '$lib/soil/siting';
import type { SoilSitingFlag } from '$lib/soil/types';
import { FT_TO_M } from './geometry';
import { GOOD_SCORE } from './score';
import type { Candidate, Confidence, Factor, FactorProvenance, FactorVerdict } from './types';

export interface ExplainOptions {
  locale?: string | null;
  units: Prefs['units'];
}

const key = (k: string) => `sitefinder.${k}` as MessageKey;

/** A ground distance in the viewer's units, e.g. "40 ft" or "12 m". */
export function distanceText(meters: number, opts: ExplainOptions): string {
  return formatQuantity(
    meters / FT_TO_M,
    'distance',
    { units: opts.units },
    { locale: opts.locale }
  );
}

export function factorText(f: Factor, opts: ExplainOptions): string {
  const { locale } = opts;
  if (f.key === 'soil.flag') {
    return soilSitingFlagText(
      { id: f.params.flag, severity: f.params.severity } as SoilSitingFlag,
      locale
    );
  }
  if (f.id === 'ai-note') return t(locale, key('f.ai.note'), { text: String(f.params.text ?? '') });
  if (f.id === 'shade') {
    const line = t(locale, key(`f.${f.key}`), {
      thing: t(locale, key(`thing.${f.params.thing}`)),
      dir: t(locale, key(`dir.${f.params.dir}`))
    });
    return f.params.guessed ? `${line} ${t(locale, key('f.shade.guessed'))}` : line;
  }
  const params: Record<string, string | number> = { ...f.params };
  if (typeof f.params.m === 'number') params.dist = distanceText(f.params.m, opts);
  return t(locale, key(`f.${f.key}`), params);
}

export interface FactorLine {
  id: Factor['id'];
  verdict: FactorVerdict;
  provenance: FactorProvenance;
  text: string;
}

export function factorLines(c: Pick<Candidate, 'factors'>, opts: ExplainOptions): FactorLine[] {
  return c.factors
    .map((f) => ({
      id: f.id,
      verdict: f.verdict,
      provenance: f.provenance,
      text: factorText(f, opts)
    }))
    .filter((l) => l.text.trim().length > 0);
}

export type SpotLabel = 'best' | 'good' | 'look';

/** The heading words for a spot: the first one that scores well is the best
 *  match, others that score well are good, the rest are worth a look. A spot
 *  with any poor factor (a very steep slope, say) is never more than worth a
 *  look, however well the rest scores. */
export function spotLabel(score: number, rank: number, hasPoorFactor = false): SpotLabel {
  if (hasPoorFactor || score < GOOD_SCORE) return 'look';
  return rank === 0 ? 'best' : 'good';
}

export function spotLabelText(label: SpotLabel, locale?: string | null): string {
  return t(locale, key(`label.${label}`));
}

export function confidenceText(c: Confidence, locale?: string | null): string {
  return t(locale, key(`confidence.${c}`));
}
