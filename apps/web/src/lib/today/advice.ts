/**
 * /today advice cards (Phase 32E, E4-15). Client-safe types. Providers live
 * server side in `lib/server/todayAdvice.server.ts`; watering is E4's and
 * degree days append one provider there (E5).
 */

import type { DigestTask } from '$lib/digest/weekly';

export type AdviceProvenance = 'data' | 'manual' | 'fallback';

export type AdviceSheet = 'log-watering' | 'rain-gauge';

export type TodayAdviceAction =
  | { kind: 'link'; label: string; href: string }
  | { kind: 'sheet'; label: string; sheet: AdviceSheet; fieldId: string };

export interface TodayAdviceCard {
  /** Stable, e.g. `water:<fieldId>` or `pest:<modelId>`. */
  id: string;
  kind: 'watering' | 'degree-days' | 'digest';
  title: string;
  lines: string[];
  provenance: AdviceProvenance;
  /** Station and distance, biofix, target source. */
  detail?: string;
  tone: 'info' | 'wheat';
  actions: TodayAdviceAction[];
  /** Lower shows first. */
  sortKey: number;
}

export interface TodayAdvicePlanting {
  id: string;
  blockId: string;
  fieldId: string | null;
  cropPluginId: string;
  cropFamily: string | null;
  status: string;
  /** In-ground date when known (watering counts only planted crops). */
  plantingDate?: number | null;
}

/** Phase 32F (F4-8). Rows the /today loader already read; the Monday
 *  card is built from these and nothing else. */
export interface TodayDigestInput {
  openTasks: DigestTask[];
  careDue: DigestTask[];
  lowStockCount: number;
  viewerId: string;
  isOwner: boolean;
  /** The viewer's zone; the card shows only on their Monday. */
  viewerTimeZone?: string;
}

export interface TodayAdviceContext {
  nowMs: number;
  seasonYear: number;
  farmLatLon: { lat: number; lon: number } | null;
  /** Active and planned plantings the /today loader already read. */
  plantings: ReadonlyArray<TodayAdvicePlanting>;
  /** Farm time zone for weekday names in the copy. */
  timeZone?: string;
  /** Owners set the water target; helpers cannot. */
  isOwner?: boolean;
  /** The Monday summary card (F4-8). */
  digest?: TodayDigestInput;
  /** The viewer's language for card text; unset is English. */
  locale?: string | null;
}

export type TodayAdviceProvider = (ctx: TodayAdviceContext) => Promise<TodayAdviceCard[]>;

/** How many cards of one kind show before "Show N more" (E4-11). */
export const ADVICE_VISIBLE_PER_KIND = 3;

export function sortAdvice(cards: readonly TodayAdviceCard[]): TodayAdviceCard[] {
  return [...cards].sort((a, b) => a.sortKey - b.sortKey || a.id.localeCompare(b.id));
}

/** A planting counts as in the ground when it is active and not dated in the future. */
export function isInGround(p: TodayAdvicePlanting, nowMs: number): boolean {
  if (p.status !== 'active') return false;
  return p.plantingDate === undefined || p.plantingDate === null || p.plantingDate <= nowMs;
}
