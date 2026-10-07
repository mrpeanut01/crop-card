import type { CalendarEvent } from './engine';

type KeyedEvent = Pick<CalendarEvent, 'kind' | 'blockId' | 'cropPluginId' | 'startMs' | 'title'> &
  Partial<Pick<CalendarEvent, 'cropId' | 'detail'>>;

export function calendarEventKeys(events: readonly KeyedEvent[]): string[] {
  const used = new Set<string>();
  return events.map((e) => {
    const harvestEventId = e.detail?.harvestEventId;
    const base = [
      e.kind,
      e.blockId,
      e.cropId ?? e.cropPluginId,
      e.startMs,
      e.title,
      typeof harvestEventId === 'string' ? harvestEventId : ''
    ].join('|');
    let key = base;
    for (let n = 1; used.has(key); n++) key = `${base}#${n}`;
    used.add(key);
    return key;
  });
}
