import { describe, expect, it } from 'vitest';
import { buildCalendarDeck } from './deck';
import {
  calendarCells,
  kindForEvent,
  kindForTask,
  suggestionScheduleMs,
  suggestionTemplateKey,
  type CalendarTaskLike
} from './calendar';

const NY = 'America/New_York';
const now = Date.parse('2026-06-04T16:00:00Z');

function task(id: string, iso: string, extra: Partial<CalendarTaskLike> = {}): CalendarTaskLike {
  return { id, title: id, kind: 'primary', scheduledFor: Date.parse(iso), ...extra };
}

describe('calendar kinds', () => {
  it('reads the record a task is tied to first, then its category', () => {
    expect(kindForTask({ relatedEventTable: 'fungicide_event', category: 'scout' })).toBe('spray');
    expect(kindForTask({ category: 'hay-cutting' })).toBe('harvest');
    expect(kindForTask({ category: 'plant' })).toBe('planting');
    expect(kindForTask({})).toBe('task');
    expect(kindForEvent({ kind: 'spray-window' })).toBe('spray');
    expect(kindForEvent({ kind: 'cover-termination' })).toBe('planting');
    expect(kindForEvent({ kind: 'orchard-task' })).toBe('task');
  });
});

describe('calendarCells', () => {
  const fromYmd = '2026-05-31';
  const toYmd = '2026-06-06';
  const tasks = [
    task('done', '2026-06-01T14:00:00Z', { completedAt: Date.parse('2026-06-01T15:00:00Z') }),
    task('late', '2026-06-02T14:00:00Z', { blockId: 'b1', category: 'spray' }),
    task('today', '2026-06-04T14:00:00Z'),
    task('prep', '2026-06-04T12:00:00Z', {
      kind: 'pre-task',
      linkedToTaskId: 'today',
      blockId: 'b2'
    })
  ];
  const entries = buildCalendarDeck(tasks, { now, timeZone: NY, fromYmd, toYmd });
  const window = (start: string, end: string, kind = 'spray-window', blockId = 'b1') => ({
    kind,
    blockId,
    startMs: Date.parse(start),
    endMs: Date.parse(end),
    title: `${kind} ${start}`
  });

  it('puts each task on its due day with its status, including past work', () => {
    const cells = calendarCells({
      entries,
      suggestions: [],
      scheduledKeys: new Set(),
      fromYmd,
      toYmd,
      todayYmd: '2026-06-04',
      timeZone: NY
    });
    expect(cells['2026-06-01'].map((c) => c.type === 'task' && c.status)).toEqual(['done']);
    const late = cells['2026-06-02'][0];
    expect(late).toMatchObject({ type: 'task', status: 'late', kind: 'spray', blockId: 'b1' });
    const today = cells['2026-06-04'][0];
    expect(today).toMatchObject({ taskId: 'today', extra: 1, blockId: 'b2' });
  });

  it('places suggestions on their first open day from today, and hides scheduled ones', () => {
    const open = window('2026-05-25', '2026-06-10');
    const later = window('2026-06-05', '2026-06-05', 'harvest-window');
    const closed = window('2026-05-20', '2026-06-01');
    const passive = window('2026-06-05', '2026-06-06', 'emergence');
    const scheduled = window('2026-06-06', '2026-06-06', 'planting', 'b3');
    const beyond = window('2026-06-09', '2026-06-12');
    const cells = calendarCells({
      entries: [],
      suggestions: [open, later, closed, passive, scheduled, beyond],
      scheduledKeys: new Set([suggestionTemplateKey(scheduled)]),
      fromYmd,
      toYmd,
      todayYmd: '2026-06-04',
      timeZone: NY
    });
    expect(Object.keys(cells).sort()).toEqual(['2026-06-04', '2026-06-05']);
    expect(cells['2026-06-04']).toEqual([
      expect.objectContaining({ type: 'suggestion', index: 0, kind: 'spray' })
    ]);
    expect(cells['2026-06-05']).toEqual([
      expect.objectContaining({ type: 'suggestion', index: 1, kind: 'harvest' })
    ]);
  });

  it('a past grid starts suggestions at today, so they drop off when today is later', () => {
    const cells = calendarCells({
      entries: [],
      suggestions: [window('2026-05-01', '2026-05-03')],
      scheduledKeys: new Set(),
      fromYmd: '2026-04-26',
      toYmd: '2026-05-30',
      todayYmd: '2026-06-04',
      timeZone: NY
    });
    expect(cells).toEqual({});
  });
});

describe('suggestionScheduleMs (scheduling a suggestion from /today)', () => {
  const windowStart = Date.parse('2026-09-24T12:00:00Z');
  it('uses the day the owner tapped, not the start of the window', () => {
    const ms = suggestionScheduleMs({ startMs: windowStart }, '2026-09-29', NY, '2026-09-29');
    expect(new Date(ms).toISOString()).toBe('2026-09-29T00:00:00.000Z');
  });

  it('never puts a task before today, so it is not Late the moment it is made', () => {
    const ms = suggestionScheduleMs({ startMs: windowStart }, '2026-09-29', NY);
    expect(new Date(ms).toISOString().slice(0, 10)).toBe('2026-09-29');
  });

  it('keeps a window that starts later on its own first day', () => {
    const ms = suggestionScheduleMs(
      { startMs: Date.parse('2026-10-03T15:00:00Z') },
      '2026-09-29',
      NY
    );
    expect(new Date(ms).toISOString().slice(0, 10)).toBe('2026-10-03');
  });
});
