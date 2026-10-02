/**
 * Phase 33C (M-51): a hay cutting from a block sprayed, on or before the
 * cut, with a product whose label limits moving hay off the farm. A notice
 * only; no time limit is shown because the labels word it differently, so
 * the citation sends the farmer to the label.
 */

import { formatCalendarDate, ymdInZone } from '$lib/prefs';

export interface HayOffFarmApplication {
  blockId: string;
  appliedAtMs: number;
  productName: string;
  productPluginId: string | null;
  restrictions: { hayOffFarmRestricted?: boolean; source?: string } | null;
  /** Set from either side of a farm copy (`hayOffFarmRestrictedFor`). */
  hayOffFarm?: { source: string | null };
}

function restricted(a: HayOffFarmApplication): boolean {
  return a.hayOffFarm !== undefined || a.restrictions?.hayOffFarmRestricted === true;
}

export interface HayOffFarmNotice {
  productName: string;
  text: string;
  appliedOn: string;
  source: string | null;
}

export function hayOffFarmText(productName: string): string {
  return `The ${productName} label limits moving or selling hay from treated ground off the farm. Read the label before you sell or move this hay.`;
}

/** Notices per cutting id, one per product (its latest qualifying spray). */
export function hayOffFarmNotices(
  cuttings: ReadonlyArray<{ id: string; blockId: string; cutAtMs: number }>,
  applications: readonly HayOffFarmApplication[],
  timeZone: string,
  locale?: string | null
): Record<string, HayOffFarmNotice[]> {
  const out: Record<string, HayOffFarmNotice[]> = {};
  const flagged = applications.filter(restricted);
  if (!flagged.length) return out;
  for (const c of cuttings) {
    const latest = new Map<string, HayOffFarmApplication>();
    for (const a of flagged) {
      if (a.blockId !== c.blockId || a.appliedAtMs > c.cutAtMs) continue;
      const key = a.productPluginId ?? a.productName;
      const prev = latest.get(key);
      if (!prev || a.appliedAtMs > prev.appliedAtMs) latest.set(key, a);
    }
    if (!latest.size) continue;
    out[c.id] = [...latest.values()]
      .sort((x, y) => y.appliedAtMs - x.appliedAtMs)
      .map((a) => ({
        productName: a.productName,
        text: hayOffFarmText(a.productName),
        appliedOn: formatCalendarDate(ymdInZone(a.appliedAtMs, timeZone), 'date', {}, locale),
        source: a.hayOffFarm?.source ?? a.restrictions?.source ?? null
      }));
  }
  return out;
}
