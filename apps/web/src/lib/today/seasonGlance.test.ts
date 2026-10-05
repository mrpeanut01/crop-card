import { describe, it, expect } from 'vitest';
import { deriveSeasonGlance, startOfYear } from './seasonGlance';
import type { CalendarEvent } from '$lib/calendar/engine';

const NOW = new Date('2026-05-24T15:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;

function ev(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    kind: over.kind ?? 'harvest-window',
    blockId: 'block-1',
    cropPluginId: 'crop:tomato',
    varietyDisplayName: 'Tomato',
    startMs: over.startMs ?? NOW + 7 * DAY,
    endMs: over.endMs ?? NOW + 14 * DAY,
    title: over.title ?? 'Harvest window',
    ...over
  };
}

describe('deriveSeasonGlance', () => {
  it('emits the 4 counts', () => {
    const out = deriveSeasonGlance({
      activePlantings: 6,
      spraysYTD: 14,
      derivedEvents: [],
      now: NOW
    });
    expect(out.activePlantings).toBe(6);
    expect(out.spraysYTD).toBe(14);
    expect(out.daysToNextHarvest).toBeNull();
  });

  it('finds nearest upcoming harvest window', () => {
    const out = deriveSeasonGlance({
      activePlantings: 1,
      spraysYTD: 0,
      now: NOW,
      derivedEvents: [ev({ startMs: NOW + 14 * DAY }), ev({ startMs: NOW + 3 * DAY })]
    });
    expect(out.daysToNextHarvest).toBe(3);
  });

  it('ignores past harvest windows', () => {
    const out = deriveSeasonGlance({
      activePlantings: 1,
      spraysYTD: 0,
      now: NOW,
      derivedEvents: [ev({ startMs: NOW - 5 * DAY }), ev({ startMs: NOW + 10 * DAY })]
    });
    expect(out.daysToNextHarvest).toBe(10);
  });

  it('ignores non-harvest events', () => {
    const out = deriveSeasonGlance({
      activePlantings: 1,
      spraysYTD: 0,
      now: NOW,
      derivedEvents: [
        ev({ kind: 'spray-window', startMs: NOW + 1 * DAY }),
        ev({ kind: 'emergence', startMs: NOW + 2 * DAY })
      ]
    });
    expect(out.daysToNextHarvest).toBeNull();
  });
});

describe('startOfYear', () => {
  it('returns Jan 1 00:00 on the farm calendar, not the server one', () => {
    const ny = 'America/New_York';
    expect(startOfYear(Date.parse('2026-05-24T15:00:00Z'), ny)).toBe(
      Date.parse('2026-01-01T05:00:00Z')
    );
    // 2027-01-01 03:00 UTC is still Dec 31 2026 on a Virginia farm.
    expect(startOfYear(Date.parse('2027-01-01T03:00:00Z'), ny)).toBe(
      Date.parse('2026-01-01T05:00:00Z')
    );
    expect(startOfYear(Date.parse('2027-01-01T03:00:00Z'), 'Asia/Tokyo')).toBe(
      Date.parse('2026-12-31T15:00:00Z')
    );
  });
});
