import { describe, expect, it } from 'vitest';
import { OBSERVED_DAYS_SHOWN, observedDays, observedFromMs } from './observedDays';

const HOUR = 3_600_000;
const TZ = 'America/New_York';

function hoursOf(dayUtcMidnight: number, temps: Array<number | null>) {
  return temps.map((tempF, i) => ({ t: dayUtcMidnight + (i + 4) * HOUR, tempF }));
}

describe('observedDays (R-9)', () => {
  const now = Date.UTC(2026, 9, 17, 16);

  it('gives the seven full days before today, oldest first, in the farm zone', () => {
    const days = observedDays([], now, TZ);
    expect(days).toHaveLength(OBSERVED_DAYS_SHOWN);
    expect(days[0].date).toBe('2026-10-10');
    expect(days.at(-1)!.date).toBe('2026-10-16');
    expect(days.every((d) => d.highF === null && d.lowF === null && !d.partial)).toBe(true);
  });

  it('takes the warmest and coldest readings, never filling in, and flags missing hours', () => {
    const full = hoursOf(Date.UTC(2026, 9, 16), [
      ...Array.from({ length: 24 }, (_, i) => 50 + (i % 12))
    ]);
    const thin = hoursOf(Date.UTC(2026, 9, 15), [40, null, 55, 48]);
    const days = observedDays([...full, ...thin], now, TZ);
    const d16 = days.find((d) => d.date === '2026-10-16')!;
    expect([d16.highF, d16.lowF, d16.hours, d16.partial]).toEqual([61, 50, 24, false]);
    const d15 = days.find((d) => d.date === '2026-10-15')!;
    expect([d15.highF, d15.lowF, d15.hours, d15.partial]).toEqual([55, 40, 3, true]);
  });

  it('ignores today and readings older than the window', () => {
    const today = hoursOf(Date.UTC(2026, 9, 17), [90]);
    const old = hoursOf(Date.UTC(2026, 8, 1), [10]);
    const days = observedDays([...today, ...old], now, TZ);
    expect(days.every((d) => d.highF === null)).toBe(true);
  });

  it('fetches from a UTC midnight that covers every day shown', () => {
    const from = observedFromMs(now);
    expect(new Date(from).getUTCHours()).toBe(0);
    expect(from).toBeLessThanOrEqual(Date.UTC(2026, 9, 10, 4));
  });
});
