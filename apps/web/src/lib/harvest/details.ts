/**
 * #662: what a harvest form measured beyond quantity and lot. Stored as
 * `harvest_events.details_json` so the lot number stays the grower's own
 * traceability code (it goes to the USDA/VDACS exports and the certifier
 * pack). Client-safe. Weights are pounds and lengths inches, as stored.
 */

import type { HarvestDetails, TerminationMethod } from './detailsSchema';
import { t, type MessageKey, type Translator } from '$lib/i18n';
import type { Quantity } from '$lib/prefs';

export {
  TERMINATION_METHODS,
  compactDetails,
  harvestDetailsSchema,
  parseStoredDetails,
  serializeDetails,
  type HarvestDetails,
  type TerminationMethod
} from './detailsSchema';

/** A typed decimal ("13,9" from a comma keyboard reads 13.9). Undefined
 *  when blank or not a number. */
export function parseDecimal(text: string | null | undefined): number | undefined {
  const s = (text ?? '').trim();
  if (!s) return undefined;
  const n = Number(s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s);
  return Number.isFinite(n) ? n : undefined;
}

const METHOD_KEY: Record<TerminationMethod, MessageKey> = {
  'roller-crimp': 'harvestui.r.cover.roller',
  mow: 'harvestui.r.cover.mow',
  'mow-flame': 'harvestui.r.cover.mowFlame',
  burndown: 'harvestui.r.cover.burndown',
  incorporate: 'harvestui.r.cover.incorporate'
};

type QtyFormat = (value: number, q: Quantity) => string;

const usQty: QtyFormat = (v, q) => `${Number(v.toFixed(2))} ${q === 'length' ? 'in' : 'lb'}`;

/** One short line per measured value, in the page's language. Without a
 *  translator the lines are English with US units. */
export function harvestDetailLines(
  d: HarvestDetails | undefined,
  tr: Translator = (key, params) => t(undefined, key, params),
  qty: QtyFormat = usQty,
  formatDate: (ymd: string) => string = (ymd) => ymd
): string[] {
  if (!d) return [];
  const lines: string[] = [];
  if (d.pickNumber !== undefined) lines.push(tr('harvestui.detail.pick', { n: d.pickNumber }));
  if (d.cutNumber !== undefined) lines.push(tr('harvestui.detail.cut', { n: d.cutNumber }));
  if (d.marketablePct !== undefined)
    lines.push(tr('harvestui.detail.marketable', { n: d.marketablePct }));
  if (d.cutHeightIn !== undefined)
    lines.push(tr('harvestui.detail.cutHeight', { v: qty(d.cutHeightIn, 'length') }));
  if (d.boltObserved) lines.push(tr('harvestui.detail.bolt'));
  if (d.dryPodLb !== undefined)
    lines.push(tr('harvestui.detail.dryPods', { v: qty(d.dryPodLb, 'weight') }));
  if (d.fruitCount !== undefined) lines.push(tr('harvestui.detail.fruits', { n: d.fruitCount }));
  if (d.cureStartDate)
    lines.push(tr('harvestui.detail.cureStart', { date: formatDate(d.cureStartDate) }));
  if (d.brix !== undefined) lines.push(tr('harvestui.detail.brix', { n: d.brix }));
  if (d.ph !== undefined) lines.push(tr('harvestui.detail.ph', { n: d.ph }));
  if (d.taGPerL !== undefined) lines.push(tr('harvestui.detail.ta', { n: d.taGPerL }));
  if (d.testWeightLbPerBu !== undefined)
    lines.push(tr('harvestui.detail.testWeight', { n: d.testWeightLbPerBu }));
  if (d.earCount !== undefined) lines.push(tr('harvestui.detail.ears', { n: d.earCount }));
  if (d.terminationMethod)
    lines.push(tr('harvestui.detail.method', { method: tr(METHOD_KEY[d.terminationMethod]) }));
  if (d.residueCoverPct !== undefined)
    lines.push(tr('harvestui.detail.residue', { n: d.residueCoverPct }));
  return lines;
}
