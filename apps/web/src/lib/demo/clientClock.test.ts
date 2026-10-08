import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clientClockScript,
  demoClockShifted,
  setClientClockOffset,
  type ClockWindow
} from './clientClock';

const REAL = Date.UTC(2026, 9, 7, 13, 0, 0);
const DAY = 86_400_000;

function fakeWindow(): ClockWindow {
  return { Date: class FakeDate extends Date {} as unknown as DateConstructor };
}

function runScript(html: string, w: ClockWindow): void {
  const body = html.replace(/^<script>/, '').replace(/<\/script>$/, '');
  new Function('window', 'Date', body)(w, w.Date);
}

describe('demo client clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(REAL);
  });
  afterEach(() => vi.useRealTimers());

  it('the inline script shifts now and new Date()', () => {
    const w = fakeWindow();
    runScript(clientClockScript(30 * DAY), w);
    expect(w.Date.now()).toBe(REAL + 30 * DAY);
    expect(new w.Date().getTime()).toBe(REAL + 30 * DAY);
    expect(new w.Date(0).getTime()).toBe(0);
  });

  it('layout data shifts a page served without the script (#667)', () => {
    const w = fakeWindow();
    setClientClockOffset(120 * DAY, w);
    expect(w.Date.now()).toBe(REAL + 120 * DAY);
    expect(new w.Date().getTime()).toBe(REAL + 120 * DAY);
  });

  it('a stale tab follows the farm offset without stacking shifts', () => {
    const w = fakeWindow();
    runScript(clientClockScript(7 * DAY), w);
    setClientClockOffset(14 * DAY, w);
    setClientClockOffset(14 * DAY, w);
    expect(w.Date.now()).toBe(REAL + 14 * DAY);
    runScript(clientClockScript(21 * DAY), w);
    expect(w.Date.now()).toBe(REAL + 21 * DAY);
  });

  it('leaves a real farm tab alone', () => {
    const w = fakeWindow();
    const before = w.Date;
    setClientClockOffset(0, w);
    runScript(clientClockScript(0), w);
    expect(w.Date).toBe(before);
    expect(w.__ccClockInstalled).toBeUndefined();
    expect(w.Date.now()).toBe(REAL);
  });
});

describe('demoClockShifted', () => {
  it('is true only for a demo farm running ahead', () => {
    expect(demoClockShifted({ demo: { offsetMs: DAY } })).toBe(true);
    expect(demoClockShifted({ demo: { offsetMs: 0 } })).toBe(false);
    expect(demoClockShifted({ demo: null })).toBe(false);
    expect(demoClockShifted(undefined)).toBe(false);
  });
});
