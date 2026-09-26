import { describe, expect, it } from 'vitest';
import { buildDayCard, buildDayCards } from './day';
import { sampleSnapshot } from './fixtures';

const prefs = { timeZone: 'America/New_York', units: 'us' as const };

describe('buildDayCard', () => {
  const snap = sampleSnapshot();

  it('today: overdue first, then the day, with the oldest as the next action', () => {
    const now = Date.parse('2026-06-04T13:00:00Z');
    const card = buildDayCard(snap, '2026-06-04', { prefs, now })!;
    expect(card.kind).toBe('day');
    expect(card.key).toBe('dy_2026-06-04');
    expect(card.title).toBe('Today');
    expect(card.kicker).toBe('Day · Thursday, June 4');
    expect(card.facts).toEqual([
      { label: 'Due', value: '1', provenance: 'data' },
      { label: 'Overdue', value: '1', provenance: 'data' }
    ]);
    expect(card.sections).toEqual([
      { title: 'Overdue', items: ['Side-dress · Cherokee Purple tomato · Bed 3'] },
      { title: 'Due today', items: ['Stake + prune suckers · Cherokee Purple tomato · Bed 3'] }
    ]);
    expect(card.next?.label).toBe('Side-dress');
  });

  it('another day lists only that day and names it plainly', () => {
    const now = Date.parse('2026-06-04T13:00:00Z');
    const tomorrow = buildDayCard(snap, '2026-06-05', { prefs, now })!;
    expect(tomorrow.title).toBe('Tomorrow');
    expect(tomorrow.facts).toEqual([
      { label: 'Due', value: 'Nothing scheduled', provenance: 'data' }
    ]);
    const later = buildDayCard(snap, '2026-06-20', { prefs, now })!;
    expect(later.title).toBe('Saturday, June 20');
    expect(later.sections).toEqual([{ title: 'Due', items: ['First cutting · North cut'] }]);
  });

  it('rejects malformed days', () => {
    expect(buildDayCard(snap, '2026-13-40')).toBeNull();
    expect(buildDayCard(snap, 'today')).toBeNull();
  });

  it('the deck holds today always and later days only when something is due', () => {
    const now = Date.parse('2026-06-10T13:00:00Z');
    expect(buildDayCards(snap, { prefs, now }).map((c) => c.key)).toEqual([
      'dy_2026-06-10',
      'dy_2026-06-12'
    ]);
  });
});
