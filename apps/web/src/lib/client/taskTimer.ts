/**
 * Phase 33D (D2). The live task timer, kept only on this device in Dexie
 * `taskTimers`, one per Owner and user (D-03, D-20, D-21). The Owner comes
 * from the same sessionStorage key every client store uses; with no Owner
 * nothing starts and nothing reads. A start reads and writes inside one
 * transaction, so two tabs cannot both start a timer.
 */

import { MAX_TASK_MINUTES, MIN_TASK_MINUTES } from '$lib/labour/hours';
import { activeCardOwnerId } from './cardStore';
import { db, type TaskTimerRow } from './dexie';

/** Fired on `window` after any start or stop, so other timers on the page
 *  re-read Dexie (D-30). */
export const TASK_TIMER_EVENT = 'cropcard:task-timer';

/** Under this, Stop says there is nothing to save (D-23). */
export const TIMER_MIN_SAVE_MS = 30_000;

export type StartResult =
  | { ok: true }
  | { ok: false; reason: 'other-task'; taskTitle: string }
  | { ok: false; reason: 'no-owner' | 'no-storage' };

export function timerStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function announce(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(TASK_TIMER_EVENT));
  } catch {
    /* no CustomEvent → other timers refresh on their own tick */
  }
}

export async function startTimer(input: {
  taskId: string;
  taskTitle: string;
  userId: string;
  now?: number;
}): Promise<StartResult> {
  if (!timerStorageAvailable()) return { ok: false, reason: 'no-storage' };
  const ownerId = activeCardOwnerId();
  if (!ownerId || !input.userId) return { ok: false, reason: 'no-owner' };
  let result: StartResult;
  try {
    const d = db();
    result = await d.transaction('rw', d.taskTimers, async () => {
      const running = await d.taskTimers.get([ownerId, input.userId]);
      if (running && running.ownerId === ownerId) {
        if (running.taskId === input.taskId) return { ok: true } as const;
        return {
          ok: false,
          reason: 'other-task',
          taskTitle: running.taskTitle?.trim() || 'another task'
        } as const;
      }
      await d.taskTimers.put({
        ownerId,
        userId: input.userId,
        taskId: input.taskId,
        startedAt: input.now ?? Date.now(),
        taskTitle: input.taskTitle
      });
      return { ok: true } as const;
    });
  } catch {
    return { ok: false, reason: 'no-storage' };
  }
  if (result.ok) announce();
  return result;
}

/** This user's running timer for the active Owner, or null. */
export async function runningTimer(userId: string): Promise<TaskTimerRow | null> {
  if (!timerStorageAvailable() || !userId) return null;
  const ownerId = activeCardOwnerId();
  if (!ownerId) return null;
  try {
    const row = await db().taskTimers.get([ownerId, userId]);
    return row && row.ownerId === ownerId && row.userId === userId ? row : null;
  } catch {
    return null;
  }
}

/** Removes this user's running timer for the active Owner. */
export async function stopTimer(userId: string): Promise<void> {
  if (!timerStorageAvailable() || !userId) return;
  const ownerId = activeCardOwnerId();
  if (!ownerId) return;
  try {
    await db().taskTimers.delete([ownerId, userId]);
  } catch {
    return;
  }
  announce();
}

/** Logout and the no-Owner case: a shared device never keeps the last
 *  person's timer (D-22). */
export async function clearTaskTimers(): Promise<void> {
  if (!timerStorageAvailable()) return;
  try {
    await db().taskTimers.clear();
  } catch {
    return;
  }
  announce();
}

/** Whole minutes the timer has run, at least 1 (D-23). */
export function elapsedMinutes(startedAt: number, now: number): number {
  const ms = now - startedAt;
  if (!Number.isFinite(ms) || ms <= 0) return MIN_TASK_MINUTES;
  return Math.max(MIN_TASK_MINUTES, Math.round(ms / 60_000));
}

/** Past 12 hours, or a clock that went backwards: ask for the real time
 *  before saving (D-05, D-24). */
export function needsRealTime(startedAt: number, now: number): boolean {
  const ms = now - startedAt;
  if (!Number.isFinite(ms) || ms < 0) return true;
  return Math.round(ms / 60_000) > MAX_TASK_MINUTES;
}

/** Less than 30 seconds: a stray tap, nothing to save (D-23). */
export function tooShortToSave(startedAt: number, now: number): boolean {
  const ms = now - startedAt;
  return Number.isFinite(ms) && ms >= 0 && ms < TIMER_MIN_SAVE_MS;
}

/** `h:mm` of a running clock (D-30). */
export function clockText(startedAt: number, now: number): string {
  const ms = now - startedAt;
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 60_000) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
