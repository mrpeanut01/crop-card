import { describe, expect, it } from 'vitest';
import {
  buildTaskDeck,
  calendarItems,
  clampView,
  clampWindow,
  deckCounts,
  eventsForWindow,
  periodForWindow,
  type DeckTaskLike
} from './deck';

const NY = 'America/New_York';
const at = (iso: string) => Date.parse(iso);
const now = at('2026-06-04T16:00:00Z');

type T = DeckTaskLike & { title: string };

function task(id: string, iso: string, extra: Partial<T> = {}): T {
  return { id, title: id, kind: 'primary', scheduledFor: at(iso), ...extra };
}

const tasks: T[] = [
  task('late', '2026-06-01T14:00:00Z'),
  task('today', '2026-06-04T14:00:00Z'),
  task('tomorrow', '2026-06-05T14:00:00Z'),
  task('in10', '2026-06-14T14:00:00Z'),
  task('in60', '2026-08-03T14:00:00Z'),
  task('doneToday', '2026-06-02T14:00:00Z', { completedAt: at('2026-06-04T13:00:00Z') }),
  task('doneYesterday', '2026-06-02T14:00:00Z', { completedAt: at('2026-06-03T13:00:00Z') }),
  task('skippedToday', '2026-06-06T14:00:00Z', { abortedAt: at('2026-06-04T13:00:00Z') }),
  task('prep', '2026-06-04T12:00:00Z', { kind: 'pre-task', linkedToTaskId: 'today' }),
  task('cleanup', '2026-06-20T12:00:00Z', { kind: 'post-task', linkedToTaskId: 'in10' }),
  task('orphanPrep', '2026-06-04T11:00:00Z', { kind: 'pre-task', linkedToTaskId: 'in60' })
];

const ids = (w: 'today' | '7d' | '30d' | 'season') =>
  buildTaskDeck(tasks, { window: w, now, timeZone: NY }).map((e) => e.task.id);

describe('buildTaskDeck', () => {
  it('today: late first, then due today, then closed today; prep sits under its job', () => {
    const deck = buildTaskDeck(tasks, { window: 'today', now, timeZone: NY });
    expect(deck.map((e) => [e.task.id, e.status])).toEqual([
      ['late', 'late'],
      ['orphanPrep', 'due-today'],
      ['today', 'due-today'],
      ['doneToday', 'done'],
      ['skippedToday', 'skipped']
    ]);
    expect(deck.find((e) => e.task.id === 'today')!.linked.map((l) => l.task.id)).toEqual(['prep']);
  });

  it('wider windows add planned work, and late work shows in every window', () => {
    expect(ids('7d')).toEqual([
      'late',
      'orphanPrep',
      'today',
      'tomorrow',
      'doneToday',
      'skippedToday'
    ]);
    expect(ids('30d')).toContain('in10');
    expect(ids('30d')).not.toContain('in60');
    expect(ids('season')).toContain('in60');
    expect(ids('season')).not.toContain('orphanPrep');
    for (const w of ['today', '7d', '30d', 'season'] as const) {
      expect(ids(w)).toContain('late');
      expect(ids(w)).not.toContain('doneYesterday');
    }
  });

  it('follow-ups sit under their job instead of taking their own card', () => {
    const deck = buildTaskDeck(tasks, { window: '30d', now, timeZone: NY });
    const in10 = deck.find((e) => e.task.id === 'in10')!;
    expect(in10.linked.map((l) => l.task.id)).toEqual(['cleanup']);
    expect(ids('30d')).not.toContain('cleanup');
  });

  it('a queued Done shows as done in every window until it syncs', () => {
    const queued = new Map([['in60', 'complete' as const]]);
    const deck = buildTaskDeck(tasks, { window: 'today', now, timeZone: NY, queued });
    const e = deck.find((x) => x.task.id === 'in60')!;
    expect(e.status).toBe('done');
    expect(e.queued).toBe('complete');
  });

  it('the day boundary follows the owner zone', () => {
    const edge = [task('ten-pm', '2026-06-05T02:00:00Z')];
    expect(
      buildTaskDeck(edge, { window: 'today', now, timeZone: NY }).map((e) => e.status)
    ).toEqual(['due-today']);
    expect(buildTaskDeck(edge, { window: 'today', now, timeZone: 'UTC' })).toEqual([]);
  });

  it('counts include the prep and follow-up lines', () => {
    const deck = buildTaskDeck(tasks, { window: 'today', now, timeZone: NY });
    expect(deckCounts(deck)).toEqual({ late: 1, dueToday: 3, planned: 0, done: 1, skipped: 1 });
  });
});

describe('window helpers', () => {
  it('clamps unknown values to the defaults', () => {
    expect(clampWindow('7d')).toBe('7d');
    expect(clampWindow('season')).toBe('season');
    expect(clampWindow('bogus')).toBe('today');
    expect(clampWindow(null)).toBe('today');
    expect(clampView('calendar')).toBe('calendar');
    expect(clampView('grid')).toBe('list');
  });

  it('maps each window onto a WeekStrip period', () => {
    expect(periodForWindow('today')).toBe('week');
    expect(periodForWindow('7d')).toBe('week');
    expect(periodForWindow('30d')).toBe('month');
    expect(periodForWindow('season')).toBe('season');
  });

  it('events: today uses the open-today list, wider windows overlap the range', () => {
    const DAY = 86_400_000;
    const soon = { startMs: now + 2 * DAY, endMs: now + 3 * DAY };
    const later = { startMs: now + 20 * DAY, endMs: now + 25 * DAY };
    const past = { startMs: now - 9 * DAY, endMs: now - 2 * DAY };
    const open = { startMs: now - DAY, endMs: now + DAY };
    const upcoming = [open, soon, later, past];
    expect(eventsForWindow(upcoming, [open], 'today', now)).toEqual([open]);
    expect(eventsForWindow(upcoming, [open], '7d', now)).toEqual([open, soon]);
    expect(eventsForWindow(upcoming, [open], '30d', now)).toEqual([open, soon, later]);
  });

  it('calendar items key on the owner calendar day and stay inside the range', () => {
    const rows = [
      { at: at('2026-06-05T02:00:00Z'), value: 'late evening' },
      { at: at('2026-06-03T12:00:00Z'), value: 'yesterday' },
      { at: at('2026-06-10T12:00:00Z'), value: 'next week' },
      { at: at('2026-06-12T12:00:00Z'), value: 'too far' }
    ];
    expect(calendarItems(rows, '2026-06-04', NY, (v) => v.toUpperCase(), 7)).toEqual({
      '2026-06-04': ['LATE EVENING'],
      '2026-06-10': ['NEXT WEEK']
    });
  });
});
