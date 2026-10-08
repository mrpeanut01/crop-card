import { resolveArchetype, type Archetype, type HarvestStyle } from '$lib/plugins/schemas';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AttributablePlanting {
  id: string;
  blockId: string;
  cropPluginId: string;
  plantingDate: number | null;
}

export interface AttributableHarvest {
  cropId?: string | null;
  blockId: string;
  cropPluginId: string;
  occurredAt: number;
}

/**
 * #718: the planting a harvest came from. Its own `cropId` when saved;
 * otherwise (rows saved before /harvest sent it) the latest planting of
 * that crop on that block planted on or before the harvest, so a later
 * resowing never inherits an older planting's picks (#272). Null when no
 * planting fits.
 */
export function attributeHarvest(
  h: AttributableHarvest,
  plantings: readonly AttributablePlanting[]
): string | null {
  if (h.cropId) return h.cropId;
  const same = plantings.filter(
    (p) => p.blockId === h.blockId && p.cropPluginId === h.cropPluginId
  );
  if (same.length === 1 && same[0].plantingDate === null) return same[0].id;
  let best: AttributablePlanting | null = null;
  for (const p of same) {
    if (p.plantingDate === null || p.plantingDate > h.occurredAt) continue;
    if (!best || (best.plantingDate ?? 0) < p.plantingDate) best = p;
  }
  return best?.id ?? null;
}

/** #662: archetypes picked again and again until the planting ends. Their
 *  days-to-maturity window says when picking starts, not when it stops. */
const OPEN_ENDED: ReadonlySet<Archetype> = new Set<Archetype>([
  'continuous-harvest-fruit',
  'cut-and-come-again-leafy'
]);

export function hasOpenEndedHarvest(p: {
  archetype?: Archetype;
  archetypeOverride?: Archetype | null;
  harvestStyle?: HarvestStyle;
  cropFamily?: string;
}): boolean {
  return OPEN_ENDED.has(
    resolveArchetype({
      archetype: p.archetypeOverride ?? p.archetype ?? undefined,
      harvestStyle: p.harvestStyle,
      cropFamily: p.cropFamily
    })
  );
}

export type HarvestStatus = 'too-early' | 'in-window' | 'past' | 'unknown';

export interface HarvestStatusResult {
  status: HarvestStatus;
  daysUntilWindow?: number;
  daysIntoWindow?: number;
  daysPastWindow?: number;
}

/** Where `now` sits against the window. An open-ended window never closes
 *  while the planting is live. */
export function harvestStatusAt(
  window: { startMs?: number; endMs?: number },
  now: number,
  openEnded = false
): HarvestStatusResult {
  const { startMs, endMs } = window;
  if (startMs === undefined || endMs === undefined) return { status: 'unknown' };
  if (now < startMs) {
    return { status: 'too-early', daysUntilWindow: Math.ceil((startMs - now) / DAY_MS) };
  }
  if (openEnded || now <= endMs) {
    return { status: 'in-window', daysIntoWindow: Math.floor((now - startMs) / DAY_MS) };
  }
  return { status: 'past', daysPastWindow: Math.floor((now - endMs) / DAY_MS) };
}
