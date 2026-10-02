/**
 * Opt-in "frost tonight" push alert. Pure selection: given the frost/freeze
 * products NWS has in force for the farm's point and the Owner's frost-tender
 * plantings, returns one alert per NWS product. The sent-log keys on the
 * product, so updates and continuations of the same advisory never re-send.
 */

import type { Hardiness } from '$lib/schedule/scheduleCandidacy';
import type { FrostAlert, FrostEvent } from '../nwsAlerts';
import { HOUR_MS, type PushAlert } from './triggers';
import { t } from '$lib/i18n';

/** Only products whose cold period starts within this lead are "tonight". */
export const FROST_ALERT_LEAD_MS = 36 * HOUR_MS;
/** Planned plantings count when their date falls in this window around now. */
export const PLANNED_LOOKBACK_MS = 30 * 24 * HOUR_MS;
export const PLANNED_LOOKAHEAD_MS = 14 * 24 * HOUR_MS;

/** Hard freeze (28°F and below, per NWS) also harms half-hardy crops. */
const AT_RISK: Record<FrostEvent, ReadonlySet<Hardiness>> = {
  'Frost Advisory': new Set(['tender']),
  'Freeze Watch': new Set(['tender']),
  'Freeze Warning': new Set(['tender']),
  'Hard Freeze Watch': new Set(['tender', 'half-hardy']),
  'Hard Freeze Warning': new Set(['tender', 'half-hardy'])
};

const HARD_FREEZE_EVENTS: ReadonlySet<FrostEvent> = new Set([
  'Hard Freeze Watch',
  'Hard Freeze Warning'
]);

export interface FrostPlantingSnapshot {
  status: 'planned' | 'active';
  plantingDate: number | null;
  name: string;
  blockName?: string;
  hardiness: Hardiness;
  /** Phase 32E: a cover active on the bed now. Heat keeps the planting out
   *  of the alert; other covers can blow off, so they only change the copy. */
  cover?: 'heated' | 'covered' | null;
}

/** Planted (active) plantings, and planned ones dated close to now. */
export function isInGroundOrImminent(p: FrostPlantingSnapshot, now: number): boolean {
  if (p.status === 'active') return true;
  if (p.plantingDate === null) return false;
  return (
    p.plantingDate >= now - PLANNED_LOOKBACK_MS && p.plantingDate <= now + PLANNED_LOOKAHEAD_MS
  );
}

export function listNames(names: string[], locale?: string | null): string {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  if (more > 0) return t(locale, 'push.list.more', { list: shown.join(', '), count: more });
  if (shown.length === 1) return shown[0];
  if (shown.length === 0) return '';
  return t(locale, 'push.list.pair', { a: shown.slice(0, -1).join(', '), b: shown.at(-1)! });
}

export function frostTonightAlerts(
  products: FrostAlert[],
  plantings: FrostPlantingSnapshot[],
  now: number,
  locale?: string | null
): PushAlert[] {
  const candidates = plantings.filter((p) => p.cover !== 'heated' && isInGroundOrImminent(p, now));
  if (candidates.length === 0) return [];
  const out: PushAlert[] = [];
  for (const product of products) {
    if (product.onsetMs !== null && product.onsetMs > now + FROST_ALERT_LEAD_MS) continue;
    if (product.endsMs !== null && product.endsMs <= now) continue;
    const atRisk = AT_RISK[product.event];
    const hit = candidates.filter((p) => atRisk.has(p.hardiness));
    const names = [...new Set(hit.map((p) => p.name))];
    if (names.length === 0) continue;
    const when = product.nwsHeadline ? ` ${sentenceCase(product.nwsHeadline)}.` : '';
    const coveredBeds = [
      ...new Set(
        hit
          .filter((p) => p.cover === 'covered')
          .map((p) => p.blockName ?? t(locale, 'push.frost.coveredBeds'))
      )
    ];
    const anyUncovered = hit.some((p) => p.cover !== 'covered');
    const hardFreeze = HARD_FREEZE_EVENTS.has(product.event);
    const action = [
      anyUncovered ? ` ${t(locale, 'push.frost.coverOrHarvest')}` : '',
      coveredBeds.length
        ? ` ${t(locale, 'push.frost.checkCovers', { beds: listNames(coveredBeds, locale) })}`
        : '',
      hardFreeze && coveredBeds.length ? ` ${t(locale, 'push.frost.hardFreeze')}` : '',
      hardFreeze && coveredBeds.length && !anyUncovered
        ? ` ${t(locale, 'push.frost.harvestOrMoreCover')}`
        : ''
    ].join('');
    const riskLine = t(locale, 'push.frost.atRisk', {
      names: listNames(names, locale),
      count: names.length
    });
    out.push({
      kind: 'frost-tonight',
      subjectId: product.productKey,
      title: t(locale, 'push.frost.title', { event: product.event }),
      body: `${riskLine}${when}${action} (NWS${product.senderName ? `, ${product.senderName.replace(/^NWS\s+/, '')}` : ''})`,
      url: '/today',
      audience: { kind: 'all' }
    });
  }
  return out;
}

function sentenceCase(s: string): string {
  const lower = s
    .toLowerCase()
    .replace(/\b(am|pm|[ecmp][sd]t|ak[sd]t|hst)\b/g, (m) => m.toUpperCase());
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
