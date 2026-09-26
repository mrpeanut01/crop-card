import { describe, expect, it } from 'vitest';
import { RECORDS_MAX_SHOW, RECORDS_PAGE_SIZE, pageOf, parseShow } from './pagination';

describe('parseShow', () => {
  it('defaults to one page', () => {
    for (const raw of [null, '', '0', '-5', 'abc', '1e3', '12.5', '99999999']) {
      expect(parseShow(raw)).toBe(RECORDS_PAGE_SIZE);
    }
  });

  it('rounds up to whole pages and caps', () => {
    expect(parseShow('1')).toBe(RECORDS_PAGE_SIZE);
    expect(parseShow(String(RECORDS_PAGE_SIZE))).toBe(RECORDS_PAGE_SIZE);
    expect(parseShow(String(RECORDS_PAGE_SIZE + 1))).toBe(RECORDS_PAGE_SIZE * 2);
    expect(parseShow('100')).toBe(100);
    expect(parseShow('9999999')).toBe(RECORDS_MAX_SHOW);
  });
});

describe('pageOf', () => {
  const rows = Array.from({ length: 120 }, (_, i) => i);

  it('returns the first page and the next step', () => {
    const p = pageOf(rows, 50);
    expect(p.rows).toEqual(rows.slice(0, 50));
    expect(p.total).toBe(120);
    expect(p.nextShow).toBe(100);
  });

  it('has no next step once everything is shown', () => {
    expect(pageOf(rows, 150)).toEqual({ rows, total: 120, nextShow: null });
    expect(pageOf([], 50)).toEqual({ rows: [], total: 0, nextShow: null });
    expect(pageOf(rows.slice(0, 50), 50).nextShow).toBeNull();
  });

  it('stops offering more at the cap', () => {
    const many = Array.from({ length: RECORDS_MAX_SHOW + 10 }, (_, i) => i);
    const p = pageOf(many, RECORDS_MAX_SHOW);
    expect(p.rows).toHaveLength(RECORDS_MAX_SHOW);
    expect(p.nextShow).toBeNull();
  });
});
