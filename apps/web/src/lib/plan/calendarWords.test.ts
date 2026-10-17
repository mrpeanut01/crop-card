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
    expect(calendarWindowFromWords('mid-March')).toEqual({
      start: { month: 3, day: 11 },
      end: { month: 3, day: 20 }
    });
    expect(calendarWindowFromWords('February or early-March')).toEqual({
      start: { month: 2, day: 1 },
      end: { month: 3, day: 10 }
    });
    expect(calendarWindowFromWords('late - April to May')).toEqual({
      start: { month: 4, day: 21 },
      end: { month: 5, day: 31 }
    });
    expect(calendarWindowFromWords('February')).toEqual({
      start: { month: 2, day: 1 },
      end: { month: 2, day: 28 }
    });
  });

  it('refuses words it cannot read', () => {
    expect(calendarWindowFromWords('at jointing')).toBeNull();
    expect(calendarWindowFromWords('mid-')).toBeNull();
    expect(calendarWindowFromWords('mid--April')).toBeNull();
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
      startMs: Date.UTC(2026, 1, 1),
      endMs: Date.UTC(2026, 2, 10)
    });
  });

  it('a planting inside the window gets the rest of that window, not next year', () => {
    const w = calendarWindowFromWords('February or early March')!;
    expect(nextCalendarWindow(w, Date.UTC(2026, 1, 20))).toEqual({
      startMs: Date.UTC(2026, 1, 20),
      endMs: Date.UTC(2026, 2, 10)
    });
    expect(nextCalendarWindow(w, Date.UTC(2026, 2, 10))).toEqual({
      startMs: Date.UTC(2026, 2, 10),
      endMs: Date.UTC(2026, 2, 10)
    });
    expect(nextCalendarWindow(w, Date.UTC(2026, 2, 11))).toEqual({
      startMs: Date.UTC(2027, 1, 1),
      endMs: Date.UTC(2027, 2, 10)
    });
  });

  it('a planting inside a window that crosses the new year keeps that window', () => {
    const w = { start: { month: 12, day: 1 }, end: { month: 1, day: 31 } };
    expect(nextCalendarWindow(w, Date.UTC(2026, 0, 15))).toEqual({
      startMs: Date.UTC(2026, 0, 15),
      endMs: Date.UTC(2026, 0, 31)
    });
    expect(nextCalendarWindow(w, Date.UTC(2026, 1, 1))).toEqual({
      startMs: Date.UTC(2026, 11, 1),
      endMs: Date.UTC(2027, 0, 31)
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
