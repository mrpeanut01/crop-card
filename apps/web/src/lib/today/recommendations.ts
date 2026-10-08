import type { CalendarEvent } from '$lib/calendar/engine';

type RecEvent = Pick<
  CalendarEvent,
  'kind' | 'blockId' | 'cropId' | 'cropPluginId' | 'varietyDisplayName' | 'title' | 'startMs'
>;

const DAY_MS = 86_400_000;

/** #712: one Recommended row per planting and event. The same event for
 *  one planting (or, with no planting id, one bed and crop) on the same day
 *  shows once; the first `limit` distinct ones are kept in order. */
export function distinctRecommendations<E extends RecEvent>(events: readonly E[], limit = 8): E[] {
  const seen = new Set<string>();
  const out: E[] = [];
  for (const e of events) {
    const who = e.cropId ?? `${e.blockId}|${e.cropPluginId ?? e.varietyDisplayName}`;
    const key = `${e.kind}|${who}|${e.title}|${Math.floor(e.startMs / DAY_MS)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** The crop line for a row, with its bed when another row would otherwise
 *  read the same. */
export function recommendationCropLines<E extends RecEvent>(
  events: readonly E[],
  cropName: (e: E) => string,
  blockName: (blockId: string) => string | undefined
): string[] {
  const text = events.map((e) => `${e.title}|${cropName(e)}|${Math.floor(e.startMs / DAY_MS)}`);
  return events.map((e, i) => {
    const crop = cropName(e);
    const clash = text.some((t, j) => j !== i && t === text[i]);
    const bed = clash ? blockName(e.blockId) : undefined;
    return bed ? `${crop} · ${bed}` : crop;
  });
}
