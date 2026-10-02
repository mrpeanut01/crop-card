import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { CropCardDb, db } from './dexie';
import {
  TASK_TIMER_EVENT,
  clearTaskTimers,
  clockText,
  elapsedMinutes,
  needsRealTime,
  runningTimer,
  startTimer,
  stopTimer,
  tooShortToSave
} from './taskTimer';

const ACTIVE_KEY = 'cropcard.activeOwnerId';
const MIN = 60_000;

function setOwner(id: string | null) {
  if (id === null) sessionStorage.removeItem(ACTIVE_KEY);
  else sessionStorage.setItem(ACTIVE_KEY, id);
}

beforeEach(async () => {
  await db().taskTimers.clear();
  sessionStorage.clear();
  setOwner('owner_a');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('starting a timer (D-21)', () => {
  it('stores one row per Owner and user, with the task title', async () => {
    expect(await startTimer({ taskId: 't1', taskTitle: 'Stake', userId: 'u1', now: 100 })).toEqual({
      ok: true
    });
    expect(await runningTimer('u1')).toEqual({
      ownerId: 'owner_a',
      userId: 'u1',
      taskId: 't1',
      startedAt: 100,
      taskTitle: 'Stake'
    });
  });

  it('a second Start on the same task changes nothing', async () => {
    await startTimer({ taskId: 't1', taskTitle: 'Stake', userId: 'u1', now: 100 });
    expect(await startTimer({ taskId: 't1', taskTitle: 'Stake', userId: 'u1', now: 900 })).toEqual({
      ok: true
    });
    expect((await runningTimer('u1'))?.startedAt).toBe(100);
  });

  it('refuses a second task and names the running one', async () => {
    await startTimer({ taskId: 't1', taskTitle: 'Stake', userId: 'u1', now: 100 });
    expect(await startTimer({ taskId: 't2', taskTitle: 'Weed', userId: 'u1' })).toEqual({
      ok: false,
      reason: 'other-task',
      taskTitle: 'Stake'
    });
    expect((await runningTimer('u1'))?.taskId).toBe('t1');
  });

  it('two starts at once leave exactly one timer', async () => {
    const [a, b] = await Promise.all([
      startTimer({ taskId: 't1', taskTitle: 'One', userId: 'u1' }),
      startTimer({ taskId: 't2', taskTitle: 'Two', userId: 'u1' })
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await db().taskTimers.count()).toBe(1);
  });

  it('another user on the same phone keeps their own timer', async () => {
    await startTimer({ taskId: 't1', taskTitle: 'One', userId: 'u1' });
    expect((await startTimer({ taskId: 't2', taskTitle: 'Two', userId: 'u2' })).ok).toBe(true);
    expect((await runningTimer('u2'))?.taskId).toBe('t2');
  });

  it('does nothing with no Owner or no user (D-20)', async () => {
    setOwner(null);
    expect(await startTimer({ taskId: 't1', taskTitle: 'x', userId: 'u1' })).toEqual({
      ok: false,
      reason: 'no-owner'
    });
    setOwner('owner_a');
    expect(await startTimer({ taskId: 't1', taskTitle: 'x', userId: '' })).toEqual({
      ok: false,
      reason: 'no-owner'
    });
    expect(await db().taskTimers.count()).toBe(0);
  });

  it('tells the page after a start and a stop (D-30)', async () => {
    const heard = vi.fn();
    window.addEventListener(TASK_TIMER_EVENT, heard);
    await startTimer({ taskId: 't1', taskTitle: 'x', userId: 'u1' });
    await stopTimer('u1');
    window.removeEventListener(TASK_TIMER_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe('keeping and clearing (D-22)', () => {
  it('survives a reload: a new database instance reads the same timer', async () => {
    await startTimer({ taskId: 't1', taskTitle: 'Stake', userId: 'u1', now: 42 });
    const fresh = new CropCardDb();
    await fresh.open();
    expect(await fresh.taskTimers.get(['owner_a', 'u1'])).toMatchObject({
      taskId: 't1',
      startedAt: 42
    });
    fresh.close();
    vi.resetModules();
    const reloaded = await import('./taskTimer');
    expect((await reloaded.runningTimer('u1'))?.taskId).toBe('t1');
  });

  it('shows only the active Owner timer, and keeps it across a switch', async () => {
    await startTimer({ taskId: 't1', taskTitle: 'A', userId: 'u1' });
    setOwner('owner_b');
    expect(await runningTimer('u1')).toBeNull();
    expect((await startTimer({ taskId: 't9', taskTitle: 'B', userId: 'u1' })).ok).toBe(true);
    setOwner('owner_a');
    expect((await runningTimer('u1'))?.taskId).toBe('t1');
  });

  it('stop removes only this Owner and user', async () => {
    await startTimer({ taskId: 't1', taskTitle: 'A', userId: 'u1' });
    await startTimer({ taskId: 't2', taskTitle: 'A', userId: 'u2' });
    setOwner('owner_b');
    await startTimer({ taskId: 't3', taskTitle: 'B', userId: 'u1' });
    setOwner('owner_a');
    await stopTimer('u1');
    expect(await runningTimer('u1')).toBeNull();
    expect((await runningTimer('u2'))?.taskId).toBe('t2');
    setOwner('owner_b');
    expect((await runningTimer('u1'))?.taskId).toBe('t3');
  });

  it('clearTaskTimers drops every timer on the device', async () => {
    await startTimer({ taskId: 't1', taskTitle: 'A', userId: 'u1' });
    setOwner('owner_b');
    await startTimer({ taskId: 't2', taskTitle: 'B', userId: 'u1' });
    await clearTaskTimers();
    expect(await db().taskTimers.count()).toBe(0);
  });

  it('logout and losing the Owner clear timers; an Owner switch keeps them', async () => {
    const sw = await import('./tenantSwitch');
    await startTimer({ taskId: 't1', taskTitle: 'A', userId: 'u1' });
    await sw.resetTenantCaches('owner_b');
    expect(await db().taskTimers.count()).toBe(1);
    await sw.forgetActiveOwner();
    expect(await db().taskTimers.count()).toBe(0);
    setOwner('owner_a');
    await startTimer({ taskId: 't1', taskTitle: 'A', userId: 'u1' });
    await sw.wipeTenantCaches();
    expect(await db().taskTimers.count()).toBe(0);
  });

  it('never returns another Owner timer (property)', async () => {
    const owners = ['owner_a', 'owner_b', 'owner_c'];
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            owner: fc.constantFrom(...owners),
            user: fc.constantFrom('u1', 'u2'),
            task: fc.constantFrom('t1', 't2', 't3'),
            stop: fc.boolean()
          }),
          { maxLength: 15 }
        ),
        fc.constantFrom(...owners),
        async (ops, active) => {
          await db().taskTimers.clear();
          const expected = new Map<string, string>();
          for (const op of ops) {
            setOwner(op.owner);
            const k = `${op.owner}|${op.user}`;
            if (op.stop) {
              await stopTimer(op.user);
              expected.delete(k);
            } else {
              const r = await startTimer({ taskId: op.task, taskTitle: op.task, userId: op.user });
              if (r.ok) expected.set(k, op.task);
            }
          }
          setOwner(active);
          for (const user of ['u1', 'u2']) {
            const row = await runningTimer(user);
            expect(row?.ownerId ?? active).toBe(active);
            expect(row?.taskId).toBe(expected.get(`${active}|${user}`));
          }
        }
      ),
      { numRuns: 40 }
    );
  });
});

describe('minutes and the 12 hour check (D-23, D-24)', () => {
  it('rounds to whole minutes, at least 1', () => {
    expect(elapsedMinutes(0, 20_000)).toBe(1);
    expect(elapsedMinutes(0, 89_000)).toBe(1);
    expect(elapsedMinutes(0, 91_000)).toBe(2);
    expect(elapsedMinutes(0, 45 * MIN)).toBe(45);
  });

  it('asks for the real time past 12 hours or after a clock change', () => {
    expect(needsRealTime(0, 720 * MIN)).toBe(false);
    expect(needsRealTime(0, 721 * MIN)).toBe(true);
    expect(needsRealTime(0, 40 * 60 * MIN)).toBe(true);
    expect(needsRealTime(10_000, 0)).toBe(true);
    expect(needsRealTime(Number.NaN, 0)).toBe(true);
  });

  it('under 30 seconds is nothing to save', () => {
    expect(tooShortToSave(0, 29_999)).toBe(true);
    expect(tooShortToSave(0, 30_000)).toBe(false);
    expect(tooShortToSave(10_000, 0)).toBe(false);
  });

  it('shows h:mm with no seconds', () => {
    expect(clockText(0, 59_000)).toBe('0:00');
    expect(clockText(0, 65 * MIN)).toBe('1:05');
    expect(clockText(0, 13 * 60 * MIN)).toBe('13:00');
    expect(clockText(5, 0)).toBe('0:00');
  });
});
