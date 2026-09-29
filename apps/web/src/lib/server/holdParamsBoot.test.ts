// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetHoldBackfillBootForTests, scheduleBootHoldBackfill } from './holdParamsBoot';
import { _fenceForTests, _resetHandoffForTests, handoffStatus } from './ops/handoff';

afterEach(() => {
  vi.useRealTimers();
  _resetHoldBackfillBootForTests();
  _resetHandoffForTests();
});

describe('boot hold-parameter backfill (C-35 §2, review round 7)', () => {
  it('runs the backfill once per process, counted as an in-flight write', async () => {
    vi.useFakeTimers();
    let inflightDuringRun = -1;
    const run = vi.fn(async () => {
      inflightDuringRun = handoffStatus().inflight;
      return 3;
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(scheduleBootHoldBackfill({}, 10, run)).toBe(true);
    expect(scheduleBootHoldBackfill({}, 10, run)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    expect(run).toHaveBeenCalledTimes(1);
    expect(inflightDuringRun).toBe(1);
    log.mockRestore();
  });

  it('does not write while the deploy handoff fence is up', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => 0);
    expect(scheduleBootHoldBackfill({}, 5, run)).toBe(true);
    _fenceForTests();
    await vi.advanceTimersByTimeAsync(5);
    expect(run).not.toHaveBeenCalled();
  });

  it('is off under tests and with HOLD_BACKFILL=off', () => {
    const run = vi.fn(async () => 0);
    expect(scheduleBootHoldBackfill({ VITEST: 'true' }, 0, run)).toBe(false);
    expect(scheduleBootHoldBackfill({ NODE_ENV: 'test' }, 0, run)).toBe(false);
    expect(scheduleBootHoldBackfill({ HOLD_BACKFILL: 'off' }, 0, run)).toBe(false);
  });
});
