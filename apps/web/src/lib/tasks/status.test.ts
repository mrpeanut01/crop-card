import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ymdInZone } from '$lib/prefs';
import {
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  closedOnYmd,
  compareByStatus,
  deriveTaskStatus,
  isClosedStatus,
  statusWithQueued
} from './status';

const NY = 'America/New_York';
const at = (iso: string) => Date.parse(iso);

describe('deriveTaskStatus', () => {
  const now = at('2026-06-04T16:00:00Z');

  it('open tasks are late, due today or planned by calendar day', () => {
    expect(deriveTaskStatus({ scheduledFor: at('2026-06-03T16:00:00Z') }, now, NY)).toBe('late');
    expect(deriveTaskStatus({ scheduledFor: at('2026-06-04T04:30:00Z') }, now, NY)).toBe(
      'due-today'
    );
    expect(deriveTaskStatus({ scheduledFor: at('2026-06-05T03:59:00Z') }, now, NY)).toBe(
      'due-today'
    );
    expect(deriveTaskStatus({ scheduledFor: at('2026-06-05T04:00:00Z') }, now, NY)).toBe('planned');
  });

  it('a task earlier today is still due today, never late', () => {
    expect(deriveTaskStatus({ scheduledFor: at('2026-06-04T12:00:00Z') }, now, NY)).toBe(
      'due-today'
    );
  });

  it('closing stamps win over the date, and done wins over skipped', () => {
    const past = at('2026-05-01T12:00:00Z');
    expect(deriveTaskStatus({ scheduledFor: past, completedAt: now }, now, NY)).toBe('done');
    expect(deriveTaskStatus({ scheduledFor: past, abortedAt: now }, now, NY)).toBe('skipped');
    expect(
      deriveTaskStatus({ scheduledFor: past, completedAt: now, abortedAt: now }, now, NY)
    ).toBe('done');
    expect(
      deriveTaskStatus({ scheduledFor: past, completedAt: null, abortedAt: null }, now, NY)
    ).toBe('late');
  });

  it('uses the owner zone, not UTC, for the day boundary', () => {
    const morning = at('2026-11-01T15:00:00Z');
    const evening = at('2026-11-02T01:00:00Z');
    expect(deriveTaskStatus({ scheduledFor: evening }, morning, NY)).toBe('due-today');
    expect(deriveTaskStatus({ scheduledFor: evening }, morning, 'UTC')).toBe('planned');
  });

  it('fall back: a 25-hour day keeps a task due all day', () => {
    const task = { scheduledFor: at('2026-11-01T04:30:00Z') };
    expect(ymdInZone(task.scheduledFor, NY)).toBe('2026-11-01');
    const lateEvening = at('2026-11-02T04:30:00Z');
    expect(ymdInZone(lateEvening, NY)).toBe('2026-11-01');
    expect(deriveTaskStatus(task, lateEvening, NY)).toBe('due-today');
    expect(deriveTaskStatus(task, at('2026-11-02T05:00:00Z'), NY)).toBe('late');
  });

  it('spring forward: a 23-hour day turns late at local midnight, not after 24 hours', () => {
    const task = { scheduledFor: at('2026-03-08T05:30:00Z') };
    expect(ymdInZone(task.scheduledFor, NY)).toBe('2026-03-08');
    expect(deriveTaskStatus(task, at('2026-03-09T03:30:00Z'), NY)).toBe('due-today');
    expect(deriveTaskStatus(task, at('2026-03-09T04:00:00Z'), NY)).toBe('late');
    expect(deriveTaskStatus(task, at('2026-03-09T04:00:00Z') - 1, NY)).toBe('due-today');
  });

  it('the same moment reads differently across the date line', () => {
    const noon = at('2026-06-04T12:00:00Z');
    const t = { scheduledFor: at('2026-06-04T10:30:00Z') };
    expect(deriveTaskStatus(t, noon, 'Pacific/Kiritimati')).toBe('due-today');
    expect(deriveTaskStatus(t, noon, 'Pacific/Pago_Pago')).toBe('late');
    const u = { scheduledFor: at('2026-06-05T10:30:00Z') };
    expect(deriveTaskStatus(u, noon, 'Pacific/Kiritimati')).toBe('planned');
    expect(deriveTaskStatus(u, noon, 'Pacific/Pago_Pago')).toBe('due-today');
  });

  it('half-hour zones cut the day at their own midnight', () => {
    const t = { scheduledFor: at('2026-06-04T18:15:00Z') };
    expect(deriveTaskStatus(t, at('2026-06-04T18:40:00Z'), 'Asia/Kolkata')).toBe('late');
    expect(deriveTaskStatus(t, at('2026-06-04T18:40:00Z'), 'Asia/Kathmandu')).toBe('due-today');
  });

  it('property: open status matches the calendar-day comparison in any zone', () => {
    const zones = ['UTC', NY, 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata'];
    const lo = at('2026-01-01T00:00:00Z');
    const hi = at('2027-01-01T00:00:00Z');
    fc.assert(
      fc.property(
        fc.integer({ min: lo, max: hi }),
        fc.integer({ min: lo, max: hi }),
        fc.constantFrom(...zones),
        (scheduledFor, nowMs, tz) => {
          const s = deriveTaskStatus({ scheduledFor }, nowMs, tz);
          const due = ymdInZone(scheduledFor, tz);
          const today = ymdInZone(nowMs, tz);
          expect(s).toBe(due < today ? 'late' : due === today ? 'due-today' : 'planned');
          expect(isClosedStatus(s)).toBe(false);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('property: closed tasks ignore the schedule entirely', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 0 }), fc.boolean(), (scheduledFor, t, done) => {
        const s = deriveTaskStatus(
          done ? { scheduledFor, completedAt: t } : { scheduledFor, abortedAt: t },
          Date.now(),
          NY
        );
        expect(s).toBe(done ? 'done' : 'skipped');
      })
    );
  });
});

describe('status helpers', () => {
  it('labels every status in plain words', () => {
    expect(TASK_STATUSES.map((s) => TASK_STATUS_LABEL[s])).toEqual([
      'Late',
      'Due today',
      'Planned',
      'Done',
      'Skipped'
    ]);
  });

  it('a queued Done or Skip shows as done or skipped until it syncs', () => {
    expect(statusWithQueued('late', 'complete')).toBe('done');
    expect(statusWithQueued('planned', 'abort')).toBe('skipped');
    expect(statusWithQueued('due-today', null)).toBe('due-today');
  });

  it('closedOnYmd reads the closing day in the owner zone', () => {
    const late = at('2026-06-05T02:00:00Z');
    expect(closedOnYmd({ scheduledFor: 0, completedAt: late }, NY)).toBe('2026-06-04');
    expect(closedOnYmd({ scheduledFor: 0, abortedAt: late }, 'UTC')).toBe('2026-06-05');
    expect(closedOnYmd({ scheduledFor: 0 }, NY)).toBeNull();
  });

  it('sorts late, due today, planned, done, skipped, then by time', () => {
    const rows = [
      { id: 'd', status: 'done' as const, scheduledFor: 1 },
      { id: 'p', status: 'planned' as const, scheduledFor: 5 },
      { id: 'l2', status: 'late' as const, scheduledFor: 2 },
      { id: 's', status: 'skipped' as const, scheduledFor: 0 },
      { id: 't', status: 'due-today' as const, scheduledFor: 3 },
      { id: 'l1', status: 'late' as const, scheduledFor: 1 }
    ];
    expect(rows.sort(compareByStatus).map((r) => r.id)).toEqual(['l1', 'l2', 't', 'p', 'd', 's']);
  });
});
