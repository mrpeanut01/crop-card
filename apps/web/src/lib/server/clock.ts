/**
 * Demo fast forward. A demo farm can move its "today" ahead of the real
 * date; this module makes `Date.now()` and `new Date()` read that shifted
 * time for the length of one demo request and nowhere else.
 *
 * The shift lives in an AsyncLocalStorage store that `runShifted` opens.
 * Outside it (every real farm, the push tick, maintenance) the offset is 0
 * and `Date` behaves exactly as before. The store is switched off as soon
 * as the request's work settles, so a timer or a lazily started background
 * loop that inherited the context reads the real clock from then on.
 *
 * Shared state (weather and elevation caches, rate limiters, sessions, the
 * demo's own expiry) must read `realNow()`, never `Date.now()`, so a shifted
 * request cannot stamp a far-future time into something another farm reads.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

interface ClockStore {
  offsetMs: number;
  active: boolean;
}

const RealDate = Date;
const realDateNow = Date.now.bind(Date);
const store = new AsyncLocalStorage<ClockStore>();

/** The wall clock, ignoring any demo fast forward. Reads `Date.now()` so
 *  test fake timers still apply. */
export function realNow(): number {
  return Date.now() - clockOffsetMs();
}

/** A time read from the shifted clock, moved back to the real one. */
export function toRealTime(ms: number): number {
  return ms - clockOffsetMs();
}

/** How far ahead the current request's clock runs (0 outside a shifted demo request). */
export function clockOffsetMs(): number {
  const s = store.getStore();
  return s && s.active ? s.offsetMs : 0;
}

let installed = false;

/** Points `Date.now()` and `new Date()` at the shifted clock. Idempotent. */
export function installShiftedClock(): void {
  if (installed) return;
  installed = true;
  RealDate.now = () => realDateNow() + clockOffsetMs();
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      if (args.length === 0) return Reflect.construct(target, [RealDate.now()], newTarget);
      return Reflect.construct(target, args, newTarget);
    }
  });
}

/** Runs `fn` with the clock `offsetMs` ahead. The shift ends when `fn`
 *  (or the promise it returns) settles. */
export function runShifted<T>(offsetMs: number, fn: () => T): T {
  if (!(offsetMs > 0)) return fn();
  installShiftedClock();
  const s: ClockStore = { offsetMs, active: true };
  let result: T;
  try {
    result = store.run(s, fn);
  } catch (err) {
    s.active = false;
    throw err;
  }
  if (result instanceof Promise) {
    return result.finally(() => {
      s.active = false;
    }) as T;
  }
  s.active = false;
  return result;
}
