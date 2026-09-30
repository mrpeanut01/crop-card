import { describe, expect, it } from 'vitest';
import type { CardCalendar, CardModel } from './model';
import {
  LANDSCAPE_PAGE_NOTE,
  fullPageLayout,
  fullPageNote,
  needsFullPage,
  paginateCards
} from './print';

type Item = { card: Pick<CardModel, 'kind' | 'bedMap' | 'calendar' | 'key'> };

const calendar = (overflow: boolean): CardCalendar => ({
  period: 'month',
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  weeks: [],
  perDay: 4,
  overflow
});

describe('Week and Month Cards print on Letter landscape (F3-6)', () => {
  it('always need their own page, whatever paper the others use', () => {
    expect(needsFullPage({ kind: 'week' })).toBe(true);
    expect(needsFullPage({ kind: 'month' })).toBe(true);
    expect(needsFullPage({ kind: 'day' })).toBe(false);
    expect(fullPageLayout({ kind: 'week' })).toBe('letter-landscape');
    expect(fullPageLayout({ kind: 'farmMap' })).toBe('letter');
    expect(fullPageNote({ kind: 'month' })).toBe(LANDSCAPE_PAGE_NOTE);
    expect(fullPageNote({ kind: 'farmMap' })).toMatch(/Letter paper/);
  });

  it('adds a list page after a crowded calendar only', () => {
    const items: Item[] = [
      { card: { kind: 'day', key: 'dy_1' } },
      { card: { kind: 'month', key: 'mo_2026-06', calendar: calendar(true) } },
      { card: { kind: 'week', key: 'wk_2026-06-01', calendar: calendar(false) } },
      { card: { kind: 'farmMap', key: 'fm_o' } }
    ];
    for (const layout of ['letter-4up', 'index-4x6', 'index-3x5'] as const) {
      const pages = paginateCards(items, layout);
      expect(pages.map((p) => [p.full, p.landscape ?? false, p.part ?? null])).toEqual([
        [false, false, null],
        [true, true, null],
        [true, true, 'list'],
        [true, true, null],
        [true, false, null]
      ]);
    }
  });
});
