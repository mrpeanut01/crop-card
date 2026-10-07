/**
 * #680: one harvest window per planting. /harvest, the Planting Card and
 * /plan read the calendar engine's `harvest-window` events through here, so
 * they show the same dates as /today.
 */

import type { CropPlugin } from '$lib/plugins/schemas';
import { isNoHarvestCover } from '$lib/plugins/growthStageTemplates';
import type { PlantingRecord } from '$lib/db/blocks';
import { eventsForPlanting, type CalendarEvent, type EventContext } from './engine';

export interface HarvestWindowSpan {
  startMs: number;
  endMs: number;
}

/** The window that matters at `now`: the one open now, else the next one to
 *  open, else the one that closed most recently. */
export function pickHarvestWindow(
  windows: readonly HarvestWindowSpan[],
  now: number
): HarvestWindowSpan | null {
  if (windows.length === 0) return null;
  const open = windows.filter((w) => w.startMs <= now && now <= w.endMs);
  if (open.length) {
    return {
      startMs: Math.min(...open.map((w) => w.startMs)),
      endMs: Math.max(...open.map((w) => w.endMs))
    };
  }
  const upcoming = windows.filter((w) => w.startMs > now).sort((a, b) => a.startMs - b.startMs);
  if (upcoming.length) return { startMs: upcoming[0].startMs, endMs: upcoming[0].endMs };
  const past = [...windows].sort((a, b) => b.endMs - a.endMs)[0];
  return { startMs: past.startMs, endMs: past.endMs };
}

/** The planting's harvest window from already-built engine events. A cover
 *  crop has no harvest; its termination window stands in for it. */
export function harvestWindowFromEvents(
  events: readonly CalendarEvent[],
  plantingId: string,
  now: number,
  kind: 'harvest-window' | 'cover-termination' = 'harvest-window'
): HarvestWindowSpan | null {
  return pickHarvestWindow(
    events.filter((e) => e.kind === kind && e.cropId === plantingId),
    now
  );
}

/** The planting's harvest window, built from the calendar engine. */
export function harvestWindowFor(
  planting: PlantingRecord,
  crop: CropPlugin,
  opts: { now: number; blockPlantings?: EventContext['blockPlantings'] }
): HarvestWindowSpan | null {
  if (planting.plantingDate == null) return null;
  const events = eventsForPlanting(planting, crop, {
    blockPlantings: opts.blockPlantings,
    now: opts.now
  });
  const kind = isNoHarvestCover(crop) ? 'cover-termination' : 'harvest-window';
  return harvestWindowFromEvents(events, planting.id, opts.now, kind);
}
