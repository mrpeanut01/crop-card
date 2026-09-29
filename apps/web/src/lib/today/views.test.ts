import { describe, expect, it } from 'vitest';
import {
  calendarGrid,
  clampTodayView,
  isYmd,
  resolveTodayParams,
  shiftAnchor,
  startOfWeekYmd
} from './views';

const params = (qs: string) => resolveTodayParams(new URLSearchParams(qs));

describe('resolveTodayParams', () => {
  it('reads the four views and defaults to Day', () => {
    expect(params('')).toEqual({ view: 'day', redirect: null });
    expect(params('view=week')).toEqual({ view: 'week', redirect: null });
    expect(params('view=month&at=2026-06-01')).toEqual({ view: 'month', redirect: null });
    expect(params('view=season&season=2025')).toEqual({ view: 'season', redirect: null });
    expect(params('view=bogus')).toEqual({ view: 'day', redirect: null });
    expect(clampTodayView(null)).toBe('day');
  });

  it('sends old window bookmarks to the matching view', () => {
    expect(params('tab=7d')).toEqual({ view: 'week', redirect: '?view=week' });
    expect(params('tab=30d')).toEqual({ view: 'month', redirect: '?view=month' });
    expect(params('tab=season')).toEqual({ view: 'season', redirect: '?view=season' });
    expect(params('tab=today')).toEqual({ view: 'day', redirect: '' });
    expect(params('tab=nonsense')).toEqual({ view: 'day', redirect: '' });
  });

  it('sends the old Cards and Calendar switch to Day and a calendar', () => {
    expect(params('view=list')).toEqual({ view: 'day', redirect: '' });
    expect(params('view=list&tab=30d')).toEqual({ view: 'day', redirect: '' });
    expect(params('view=calendar')).toEqual({ view: 'week', redirect: '?view=week' });
    expect(params('view=calendar&tab=30d')).toEqual({ view: 'month', redirect: '?view=month' });
    expect(params('view=calendar&tab=today')).toEqual({ view: 'week', redirect: '?view=week' });
  });

  it('keeps unrelated parameters through the redirect', () => {
    expect(params('tab=7d&at=2026-06-01')).toEqual({
      view: 'week',
      redirect: '?at=2026-06-01&view=week'
    });
  });
});

describe('calendar grids', () => {
  it('validates dates', () => {
    expect(isYmd('2026-02-28')).toBe(true);
    expect(isYmd('2026-02-30')).toBe(false);
    expect(isYmd('26-02-01')).toBe(false);
    expect(isYmd(null)).toBe(false);
  });

  it('starts weeks on the locale first day', () => {
    expect(startOfWeekYmd('2026-09-30', 0)).toBe('2026-09-27');
    expect(startOfWeekYmd('2026-09-30', 1)).toBe('2026-09-28');
    expect(startOfWeekYmd('2026-09-27', 0)).toBe('2026-09-27');
  });

  it('a week is seven days holding the anchor', () => {
    const g = calendarGrid('week', '2026-09-29', 0);
    expect(g.weeks).toHaveLength(1);
    expect(g.weeks[0]).toEqual([
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03'
    ]);
    expect(g.month).toBeNull();
  });

  it('a month runs whole weeks around the month', () => {
    const g = calendarGrid('month', '2026-09-29', 0);
    expect(g.month).toBe('2026-09');
    expect(g.fromYmd).toBe('2026-08-30');
    expect(g.toYmd).toBe('2026-10-03');
    expect(g.weeks).toHaveLength(5);
    for (const w of g.weeks) expect(w).toHaveLength(7);
    const feb = calendarGrid('month', '2026-02-10', 0);
    expect(feb.fromYmd).toBe('2026-02-01');
    expect(feb.toYmd).toBe('2026-02-28');
    expect(feb.weeks).toHaveLength(4);
    const mondayFirst = calendarGrid('month', '2026-03-15', 1);
    expect(mondayFirst.fromYmd).toBe('2026-02-23');
    expect(mondayFirst.toYmd).toBe('2026-04-05');
  });

  it('pages a week or a month at a time', () => {
    expect(shiftAnchor('week', '2026-09-29', 1)).toBe('2026-10-06');
    expect(shiftAnchor('week', '2026-01-02', -1)).toBe('2025-12-26');
    expect(shiftAnchor('month', '2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftAnchor('month', '2026-01-15', -1)).toBe('2025-12-01');
  });
});
