import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { frostDatesFromMmDd } from './frostSeason';
import { formatCalendarDate, formatDueDay, type Prefs } from '$lib/prefs';

const savedTz = process.env.TZ;

describe.each(['America/New_York', 'Asia/Tokyo', 'Pacific/Honolulu'])(
  'frost dates are calendar days in %s (#626)',
  (zone) => {
    beforeEach(() => {
      process.env.TZ = zone;
    });
    afterEach(() => {
      process.env.TZ = savedTz;
    });

    it('builds UTC midnights that read as the saved day', () => {
      const f = frostDatesFromMmDd(2027, '04-20', '10-18');
      expect(f.lastSpringFrostMs).toBe(Date.UTC(2027, 3, 20));
      expect(f.firstFallFrostMs).toBe(Date.UTC(2027, 9, 18));
      expect(formatCalendarDate(f.lastSpringFrostMs, 'date', {}, 'en')).toBe('Apr 20, 2027');
      expect(formatCalendarDate(f.firstFallFrostMs, 'date', {}, 'en')).toBe('Oct 18, 2027');
      const prefs = { timeZone: zone, locale: 'en' } as Prefs;
      expect(formatDueDay(f.lastSpringFrostMs, prefs, 'date')).toBe('Apr 20, 2027');
    });
  }
);
