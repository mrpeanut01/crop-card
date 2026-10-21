/** Close-out CO-4: what an herb is infused in, and the food-safety line the
 *  app shows for each medium. The words are the app's, so a farm copy of a
 *  plugin cannot weaken them; each one follows the medium's gated safety
 *  quote (`preserving.infuse.<medium>.safety` in crop-data-sources.json).
 *  Client-safe. With no locale every helper returns English. */

import { t } from '$lib/i18n';

export const INFUSE_MEDIA = ['oil', 'vinegar'] as const;
export type InfuseMedium = (typeof INFUSE_MEDIA)[number];

/** UGA Extension Circular 1334: oil infused with unacidified herbs is kept in
 *  the refrigerator and discarded 4 days after it is made. Every oil safety
 *  quote states this number (`infuseMedium.sources.gate.test.ts`). */
export const INFUSE_OIL_DISCARD_DAYS = 4;

export function isInfuseMedium(v: unknown): v is InfuseMedium {
  return v === 'oil' || v === 'vinegar';
}

/** "Infused in oil" or "Infused in vinegar". */
export function infuseMethodLabel(m: InfuseMedium, locale?: string | null): string {
  return t(locale, m === 'oil' ? 'herbinfuse.method.oil' : 'herbinfuse.method.vinegar');
}

/** The medium's food-safety line, shown wherever an infuse goal or row is. */
export function infuseSafetyLine(m: InfuseMedium, locale?: string | null): string {
  return m === 'oil'
    ? t(locale, 'herbinfuse.safety.oil', { days: INFUSE_OIL_DISCARD_DAYS })
    : t(locale, 'herbinfuse.safety.vinegar');
}

/** The media named by a crop's infuse rows, oil before vinegar. With
 *  `suitableOnly`, only rows rated good or fair. */
export function infuseMediaOf(
  rows: ReadonlyArray<{ method: string; suitability?: string; medium?: string }> | undefined,
  suitableOnly = false
): InfuseMedium[] {
  const found = new Set<InfuseMedium>();
  for (const r of rows ?? []) {
    if (r.method !== 'infuse' || !isInfuseMedium(r.medium)) continue;
    if (suitableOnly && r.suitability !== 'good' && r.suitability !== 'fair') continue;
    found.add(r.medium);
  }
  return INFUSE_MEDIA.filter((m) => found.has(m));
}
