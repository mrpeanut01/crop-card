import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CropPlugin } from '$lib/plugins/schemas';
import { eventsForPlanting, eventsInRange, type CalendarEvent } from './engine';
import { calendarEventKeys } from './eventKey';

const corn: CropPlugin = {
  pluginId: 'corn-bb',
  type: 'crop',
  displayName: 'Bloody Butcher',
  version: '1.0.0',
  cropFamily: 'corn',
  harvestStyle: 'row-grain-pollinated',
  bloomWindow: { daysFromPlantingMin: 55, daysFromPlantingMax: 75, beeAttractive: false },
  daysToMaturity: { min: 90, max: 100 }
};

const t0 = Date.UTC(2026, 4, 5);

function twoPlantingsOneBlock(): CalendarEvent[] {
  return ['planting-1', 'planting-2'].flatMap((id) =>
    eventsForPlanting(
      {
        id,
        blockId: 'block-1',
        cropPluginId: corn.pluginId,
        varietyDisplayName: corn.displayName,
        plantingDate: t0
      },
      corn
    )
  );
}

describe('calendarEventKeys', () => {
  it('keeps two plantings of one crop in one block on one date apart', () => {
    const events = twoPlantingsOneBlock();
    const legacy = events.map((e) => e.kind + e.blockId + e.startMs + e.title);
    expect(new Set(legacy).size).toBeLessThan(events.length);
    const keys = calendarEventKeys(events);
    expect(new Set(keys).size).toBe(events.length);
  });

  it('gives unique keys for the events open on any one day', () => {
    const events = twoPlantingsOneBlock();
    for (let d = 0; d < 120; d += 5) {
      const day = t0 + d * 86_400_000;
      const open = eventsInRange(events, day, day + 86_400_000 - 1);
      expect(new Set(calendarEventKeys(open)).size).toBe(open.length);
    }
  });

  it('is stable for a planting whatever else is listed after it', () => {
    const events = twoPlantingsOneBlock();
    const first = events.filter((e) => e.cropId === 'planting-1');
    expect(calendarEventKeys(events).slice(0, first.length)).toEqual(calendarEventKeys(first));
  });

  it('never repeats a key, even for identical events', () => {
    const ev = fc.record({
      kind: fc.constantFrom('planting', 'spray-window', 'curing'),
      blockId: fc.constantFrom('b1', 'b2'),
      cropPluginId: fc.constant('corn-bb'),
      cropId: fc.option(fc.constantFrom('p1', 'p2'), { nil: undefined }),
      startMs: fc.constantFrom(0, 1),
      title: fc.constantFrom('A', 'B', 'A#1')
    });
    fc.assert(
      fc.property(fc.array(ev, { maxLength: 30 }), (events) => {
        const keys = calendarEventKeys(events as CalendarEvent[]);
        expect(new Set(keys).size).toBe(events.length);
      })
    );
  });
});
