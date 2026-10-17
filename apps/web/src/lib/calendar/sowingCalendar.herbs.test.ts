import { describe, expect, it } from 'vitest';
import { buildSowingCalendar, SOWING_BAR_LABEL, type SowingCalendarInput } from './sowingCalendar';

const base: SowingCalendarInput = {
  year: 2026,
  now: Date.UTC(2026, 5, 1),
  fromMs: Date.UTC(2026, 0, 1),
  toMs: Date.UTC(2026, 11, 31),
  plantings: [
    {
      id: 'c1',
      name: 'Rosemary',
      blockId: 'b1',
      blockName: 'Herb bed',
      plantingDate: Date.UTC(2026, 4, 1),
      status: 'active'
    }
  ],
  events: [],
  windows: {},
  frostByBlock: {},
  frostLines: [{ kind: 'first-fall', ms: Date.UTC(2026, 9, 15), provenance: 'manual' }],
  latLon: null
};

describe('sowing calendar herb bars (37D)', () => {
  it('draws bring-indoors and restart as planned, typical-timing bars', () => {
    const cal = buildSowingCalendar({
      ...base,
      events: [
        {
          kind: 'bring-indoors',
          cropId: 'c1',
          startMs: Date.UTC(2026, 9, 1),
          endMs: Date.UTC(2026, 9, 15),
          title: 'Bring Rosemary indoors or take cuttings',
          detail: { herbEvent: 'bring-indoors', typicalTiming: true }
        },
        {
          kind: 'restart',
          cropId: 'c1',
          startMs: Date.UTC(2026, 4, 15),
          endMs: Date.UTC(2026, 4, 22),
          title: 'Sow Rosemary again'
        },
        {
          kind: 'harvest-window',
          cropId: 'c1',
          startMs: Date.UTC(2026, 6, 1),
          endMs: Date.UTC(2026, 7, 1),
          title: 'Harvest window: Rosemary'
        }
      ]
    });
    const bars = cal.rows[0].bars;
    expect(bars.map((b) => b.kind)).toEqual(['restart', 'bring-indoors']);
    expect(bars.every((b) => !b.recorded)).toBe(true);
    expect(bars.find((b) => b.kind === 'bring-indoors')?.typical).toBe(true);
    expect(bars.find((b) => b.kind === 'restart')?.typical).toBeUndefined();
    expect(SOWING_BAR_LABEL['bring-indoors']).toBe('Bring indoors');
  });
});
