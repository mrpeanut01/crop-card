/**
 * #820: reads what the season cap kernel (`lib/safety/seasonCap.ts`) needs
 * for one herbicide pass on one block: the label cap rows for the sprayed
 * crops and every other application of those products on the block in the
 * window. Saved records come through `listSprayEvents` and deleted ones
 * through `listApplicationTombstones` (both tenant-scoped); a "never
 * applied" delete or void is left out by the tombstone loader (SC-4).
 */

import { listApplicationTombstones } from '$lib/db/admin';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { farmTimeZone } from '$lib/db/userProfile';
import type { HerbicidePlugin } from '$lib/plugins/schemas';
import {
  capsForCrops,
  seasonCapReadSpan,
  type SeasonCapApplication,
  type SeasonCapContext,
  type SeasonCapRate
} from '$lib/safety/seasonCap';

type CapProduct = Pick<
  HerbicidePlugin,
  'pluginId' | 'displayName' | 'ratePerAcre' | 'seasonCapByCrop'
>;

function storedRate(rate: unknown): SeasonCapRate | null {
  if (!rate || typeof rate !== 'object') return null;
  const r = rate as { amount?: unknown; unit?: unknown };
  if (typeof r.amount !== 'number' || !Number.isFinite(r.amount) || r.amount < 0) return null;
  if (typeof r.unit !== 'string') return null;
  return { amount: r.amount, unit: r.unit };
}

export function loadSeasonCapContext(input: {
  blockId: string;
  occurredAt: number;
  cropPluginIds: readonly string[];
  /** The products as the mix sees them (`withCropRate` applied). */
  products: readonly CapProduct[];
  /** This pass uses an owner's custom rate, so its amount is not known. */
  customRateOverride?: boolean;
}): SeasonCapContext | null {
  const capped = input.products
    .map((p) => ({ p, caps: capsForCrops(p.seasonCapByCrop, input.cropPluginIds) }))
    .filter((x) => x.caps.length > 0);
  if (capped.length === 0) return null;

  const timeZone = farmTimeZone();
  const span = seasonCapReadSpan(
    input.occurredAt,
    capped.flatMap((x) => x.caps.map((c) => c.period)),
    timeZone
  );
  if (!span) return null;
  const [fromMs, toMs] = span;
  const ids = new Set(capped.map((x) => x.p.pluginId));

  const others: SeasonCapApplication[] = [];
  for (const e of listSprayEvents({ blockId: input.blockId, fromMs, toMs })) {
    for (const prod of e.products) {
      if (!ids.has(prod.pluginId)) continue;
      others.push({
        id: `spray:${e.id}`,
        pluginId: prod.pluginId,
        occurredAt: e.occurredAt,
        rate: e.customRateOverride ? null : storedRate(prod.rate)
      });
    }
  }
  for (const t of listApplicationTombstones(fromMs)) {
    if (t.source !== 'spray' || t.blockId !== input.blockId || t.occurredAt >= toMs) continue;
    for (const prod of t.products) {
      if (!prod.pluginId || !ids.has(prod.pluginId)) continue;
      others.push({
        id: `deleted-spray:${t.id}`,
        pluginId: prod.pluginId,
        occurredAt: t.occurredAt,
        rate: t.customRateOverride ? null : storedRate(prod.rate)
      });
    }
  }

  return {
    occurredAt: input.occurredAt,
    cropPluginIds: input.cropPluginIds,
    products: capped.map(({ p, caps }) => ({
      pluginId: p.pluginId,
      displayName: p.displayName,
      rate: input.customRateOverride ? null : storedRate(p.ratePerAcre),
      caps
    })),
    others,
    timeZone
  };
}
