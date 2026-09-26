/**
 * Opt-in "frost tonight" push alert. Pure selection: given the frost/freeze
 * products NWS has in force for the farm's point and the Owner's frost-tender
 * plantings, returns one alert per NWS product. The sent-log keys on the
 * product, so updates and continuations of the same advisory never re-send.
 */

import type { Hardiness } from '$lib/schedule/scheduleCandidacy';
import type { FrostAlert, FrostEvent } from '../nwsAlerts';
import { HOUR_MS, type PushAlert } from './triggers';

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

export interface FrostPlantingSnapshot {
  status: 'planned' | 'active';
  plantingDate: number | null;
  name: string;
  blockName?: string;
  hardiness: Hardiness;
}

/** Planted (active) plantings, and planned ones dated close to now. */
export function isInGroundOrImminent(p: FrostPlantingSnapshot, now: number): boolean {
  if (p.status === 'active') return true;
  if (p.plantingDate === null) return false;
  return (
    p.plantingDate >= now - PLANNED_LOOKBACK_MS && p.plantingDate <= now + PLANNED_LOOKAHEAD_MS
  );
}

function listNames(names: string[]): string {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  const joined =
    shown.length <= 2
      ? shown.join(' and ')
      : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : joined;
}

export function frostTonightAlerts(
  products: FrostAlert[],
  plantings: FrostPlantingSnapshot[],
  now: number
): PushAlert[] {
  const candidates = plantings.filter((p) => isInGroundOrImminent(p, now));
  if (candidates.length === 0) return [];
  const out: PushAlert[] = [];
  for (const product of products) {
    if (product.onsetMs !== null && product.onsetMs > now + FROST_ALERT_LEAD_MS) continue;
    if (product.endsMs !== null && product.endsMs <= now) continue;
    const atRisk = AT_RISK[product.event];
    const names = [
      ...new Set(candidates.filter((p) => atRisk.has(p.hardiness)).map((p) => p.name))
    ];
    if (names.length === 0) continue;
    const when = product.nwsHeadline ? ` ${sentenceCase(product.nwsHeadline)}.` : '';
    out.push({
      kind: 'frost-tonight',
      subjectId: product.productKey,
      title: `${product.event} · protect tender crops`,
      body: `${listNames(names)} ${names.length === 1 ? 'is' : 'are'} at risk.${when} Cover or harvest before the cold sets in. (NWS${product.senderName ? `, ${product.senderName.replace(/^NWS\s+/, '')}` : ''})`,
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
