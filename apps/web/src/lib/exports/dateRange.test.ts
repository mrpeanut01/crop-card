import { describe, expect, it } from 'vitest';
import { parseExportDateRange, zonedDayStartMs } from './dateRange';

function p(qs: string, timeZone?: string) {
  return parseExportDateRange(new URLSearchParams(qs), timeZone ? { timeZone } : undefined);
}

describe('parseExportDateRange (#325)', () => {
  it('parses ISO date strings passed by the /records UI as days in the default zone', () => {
    const { fromMs, toMs } = p('from=2026-01-01&to=2026-01-31');
    expect(fromMs).toBe(Date.parse('2026-01-01T00:00:00-05:00'));
    // `to` is extended to end-of-day so the range is inclusive.
    expect(toMs).toBe(Date.parse('2026-02-01T00:00:00-05:00') - 1);
  });

  it('resolves date-only bounds in the requested zone', () => {
    expect(p('from=2026-07-01&to=2026-07-01', 'UTC')).toEqual({
      fromMs: Date.parse('2026-07-01T00:00:00Z'),
      toMs: Date.parse('2026-07-02T00:00:00Z') - 1
    });
    expect(p('from=2026-07-01', 'America/Los_Angeles').fromMs).toBe(
      Date.parse('2026-07-01T00:00:00-07:00')
    );
    expect(p('from=2026-07-01', 'Asia/Tokyo').fromMs).toBe(Date.parse('2026-07-01T00:00:00+09:00'));
  });

  it('covers a 23-hour DST day exactly', () => {
    const { fromMs, toMs } = p('from=2026-03-08&to=2026-03-08', 'America/New_York');
    expect(fromMs).toBe(Date.parse('2026-03-08T00:00:00-05:00'));
    expect(toMs).toBe(Date.parse('2026-03-09T00:00:00-04:00') - 1);
    expect(toMs! - fromMs! + 1).toBe(23 * 60 * 60 * 1000);
  });

  it('parses epoch-millisecond values verbatim', () => {
    const from = 1_700_000_000_000;
    const to = 1_800_000_000_000;
    const { fromMs, toMs } = p(`from=${from}&to=${to}`);
    expect(fromMs).toBe(from);
    expect(toMs).toBe(to);
  });

  it('returns undefined for missing params', () => {
    expect(p('')).toEqual({ fromMs: undefined, toMs: undefined });
  });

  it('returns undefined for garbage instead of NaN', () => {
    expect(p('from=not-a-date&to=also-bad')).toEqual({ fromMs: undefined, toMs: undefined });
  });

  it('handles from-only and to-only ranges', () => {
    expect(p('from=2026-06-01').toMs).toBeUndefined();
    expect(p('from=2026-06-01').fromMs).toBe(Date.parse('2026-06-01T00:00:00-04:00'));
    expect(p('to=2026-06-30').fromMs).toBeUndefined();
  });
});

describe('zonedDayStartMs', () => {
  it('rolls month overflow forward', () => {
    expect(zonedDayStartMs(2026, 1, 32, 'UTC')).toBe(Date.parse('2026-02-01T00:00:00Z'));
  });
});
