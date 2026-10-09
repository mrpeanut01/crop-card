import { describe, expect, it } from 'vitest';
import { calendarWindowFromWords, nextCalendarWindow } from './calendarWords';

describe('calendar words (#720 ruling R720-2)', () => {
  it('maps the source words to day windows', () => {
    expect(calendarWindowFromWords('late March')).toEqual({
      start: { month: 3, day: 21 },
      end: { month: 3, day: 31 }
    });
    expect(calendarWindowFromWords('February or early March')).toEqual({
      start: { month: 2, day: 1 },
      end: { month: 3, day: 10 }
    });
    expect(calendarWindowFromWords('mid April')).toEqual({
      start: { month: 4, day: 11 },
      end: { month: 4, day: 20 }
    });
    expect(calendarWindowFromWords('February')).toEqual({
      start: { month: 2, day: 1 },
      end: { month: 2, day: 28 }
    });
  });

  it('refuses words it cannot read', () => {
    expect(calendarWindowFromWords('at jointing')).toBeNull();
    expect(calendarWindowFromWords('very late March')).toBeNull();
    expect(calendarWindowFromWords('')).toBeNull();
  });

  it('takes the first window after planting', () => {
    const w = calendarWindowFromWords('February or early March')!;
    expect(nextCalendarWindow(w, Date.UTC(2025, 9, 15))).toEqual({
      startMs: Date.UTC(2026, 1, 1),
      endMs: Date.UTC(2026, 2, 10)
    });
    expect(nextCalendarWindow(w, Date.UTC(2026, 0, 10))).toEqual({
      startMs: Date.UTC(2026, 1, 1),
      endMs: Date.UTC(2026, 2, 10)
    });
    expect(nextCalendarWindow(w, Date.UTC(2026, 1, 1))).toEqual({
      startMs: Date.UTC(2027, 1, 1),
      endMs: Date.UTC(2027, 2, 10)
    });
  });

  it('a window that ends before it starts runs into the next year', () => {
    const w = { start: { month: 12, day: 1 }, end: { month: 1, day: 31 } };
    expect(nextCalendarWindow(w, Date.UTC(2025, 9, 1))).toEqual({
      startMs: Date.UTC(2025, 11, 1),
      endMs: Date.UTC(2026, 0, 31)
    });
  });
});
