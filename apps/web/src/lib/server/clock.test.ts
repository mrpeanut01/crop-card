// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { clockOffsetMs, realNow, runShifted } from './clock';

const DAY = 86_400_000;

describe('runShifted', () => {
  it('moves Date.now and new Date() only inside the call', () => {
    const before = Date.now();
    const inside = runShifted(10 * DAY, () => ({
      now: Date.now(),
      date: new Date().getTime(),
      real: realNow(),
      offset: clockOffsetMs()
    }));
    expect(inside.offset).toBe(10 * DAY);
    expect(inside.now - inside.real).toBeGreaterThanOrEqual(10 * DAY - 5);
    expect(inside.date - inside.real).toBeGreaterThanOrEqual(10 * DAY - 5);
    expect(Math.abs(Date.now() - before)).toBeLessThan(1000);
    expect(clockOffsetMs()).toBe(0);
  });

  it('keeps explicit dates and instanceof working', () => {
    runShifted(DAY, () => {
      expect(new Date(0).getTime()).toBe(0);
      expect(new Date('2026-01-02T00:00:00Z').getUTCDate()).toBe(2);
      expect(new Date() instanceof Date).toBe(true);
      expect(Object.prototype.toString.call(new Date())).toBe('[object Date]');
    });
  });

  it('applies across awaits and stops once the work settles', async () => {
    let later: (() => number) | null = null;
    const seen = await runShifted(5 * DAY, async () => {
      await new Promise((r) => setTimeout(r, 1));
      later = () => clockOffsetMs();
      return clockOffsetMs();
    });
    expect(seen).toBe(5 * DAY);
    expect(later!()).toBe(0);
  });

  it('does nothing for a zero offset', () => {
    expect(runShifted(0, () => clockOffsetMs())).toBe(0);
  });

  it('does not leak into concurrent unshifted work', async () => {
    const shifted = runShifted(30 * DAY, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return clockOffsetMs();
    });
    const plain = (async () => {
      await new Promise((r) => setTimeout(r, 1));
      return clockOffsetMs();
    })();
    expect(await plain).toBe(0);
    expect(await shifted).toBe(30 * DAY);
  });
});
