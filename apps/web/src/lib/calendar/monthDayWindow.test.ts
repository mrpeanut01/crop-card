import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { crossesNewYear, projectMonthDayWindow } from './monthDayWindow';
import { projectHarvestSeason } from './stageProjection';
import { nextCalendarWindow } from '../plan/calendarWords';

const LAST_DAY = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const monthDay = fc
  .integer({ min: 1, max: 12 })
  .chain((month) =>
    fc.integer({ min: 1, max: LAST_DAY[month - 1] }).map((day) => ({ month, day }))
  );

const window = fc.record({ start: monthDay, end: monthDay });

function localYmd(ms: number): [number, number, number] {
  const d = new Date(ms);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
}

function utcYmd(ms: number): [number, number, number] {
  const d = new Date(ms);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

describe('projectMonthDayWindow', () => {
  it('runs a window whose end is before its start into the next year', () => {
    const w = { start: { month: 11, day: 15 }, end: { month: 2, day: 10 } };
    expect(crossesNewYear(w)).toBe(true);
    expect(projectMonthDayWindow(w, 2026, { zone: 'utc', end: 'startOfDay' })).toEqual({
      startMs: Date.UTC(2026, 10, 15),
      endMs: Date.UTC(2027, 1, 10)
    });
    expect(projectMonthDayWindow(w, 2026, { zone: 'utc', end: 'endOfDay' })).toEqual({
      startMs: Date.UTC(2026, 10, 15),
      endMs: Date.UTC(2027, 1, 11) - 1
    });
  });

  it('treats a one-day window as not crossing the new year', () => {
    expect(crossesNewYear({ start: { month: 3, day: 1 }, end: { month: 3, day: 1 } })).toBe(false);
  });

  it('harvest season and planner window name the same days, each on its own basis', () => {
    fc.assert(
      fc.property(window, fc.integer({ min: 2000, max: 2100 }), (w, year) => {
        const harvest = projectHarvestSeason(w, year);
        const planner = nextCalendarWindow(w, Date.UTC(year, w.start.month - 1, w.start.day));

        expect(localYmd(harvest.startMs)).toEqual(utcYmd(planner.startMs));
        expect(localYmd(harvest.endMs)).toEqual(utcYmd(planner.endMs));

        expect(new Date(harvest.startMs).getHours()).toBe(0);
        expect(new Date(harvest.startMs).getMinutes()).toBe(0);
        expect(new Date(harvest.endMs + 1).getHours()).toBe(0);
        expect(new Date(harvest.endMs + 1).getMinutes()).toBe(0);
        expect(localYmd(harvest.endMs + 1)).not.toEqual(localYmd(harvest.endMs));

        expect(planner.startMs % 86_400_000).toBe(0);
        expect(planner.endMs % 86_400_000).toBe(0);
      })
    );
  });
});
