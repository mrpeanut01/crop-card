import { describe, expect, it } from 'vitest';
import { parseExportDateRange } from './dateRange';

function p(qs: string) {
  return parseExportDateRange(new URLSearchParams(qs));
}

describe('parseExportDateRange (#325)', () => {
  it('parses ISO date strings passed by the /records UI', () => {
    const { fromMs, toMs } = p('from=2026-01-01&to=2026-01-31');
    expect(fromMs).toBe(Date.parse('2026-01-01'));
    // `to` is extended to end-of-day so the range is inclusive.
    expect(toMs).toBe(Date.parse('2026-01-31') + 24 * 60 * 60 * 1000 - 1);
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
    expect(p('from=2026-06-01').fromMs).toBe(Date.parse('2026-06-01'));
    expect(p('to=2026-06-30').fromMs).toBeUndefined();
  });
});
