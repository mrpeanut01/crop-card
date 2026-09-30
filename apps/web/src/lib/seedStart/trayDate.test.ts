import { describe, expect, it } from 'vitest';
import { localDayInput, traySownAt } from './trayDate';

describe('traySownAt', () => {
  it('saves today as now, never in the future, early or late in the day', () => {
    for (const hour of [0, 7, 12, 21, 23]) {
      const now = new Date(2026, 8, 30, hour, 15).getTime();
      const day = localDayInput(now);
      expect(day).toBe('2026-09-30');
      expect(traySownAt(day, now)).toBe(now);
    }
  });

  it('saves another day at local noon', () => {
    const now = new Date(2026, 8, 30, 7).getTime();
    expect(traySownAt('2026-09-28', now)).toBe(new Date(2026, 8, 28, 12).getTime());
  });

  it('refuses an unreadable day', () => {
    expect(traySownAt('', Date.now())).toBeNull();
  });
});
