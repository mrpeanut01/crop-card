import { describe, expect, it } from 'vitest';
import {
  MAX_DEMO_OFFSET_MS,
  currentPhase,
  fastForwardOffset,
  nextPhaseStart,
  parseFastForwardChoice
} from './fastForward';
import { DAY_MS, ymdOf, zonedMs } from './time';

const real = zonedMs('2026-10-07', 14);

describe('fast forward', () => {
  it('steps keep the time of day', () => {
    const off = fastForwardOffset({ step: 'week' }, real, 0)!;
    expect(ymdOf(real + off)).toBe('2026-10-14');
    expect(off).toBe(7 * DAY_MS);
  });

  it('steps add to the current offset', () => {
    const off = fastForwardOffset({ step: 'day' }, real, 3 * DAY_MS)!;
    expect(ymdOf(real + off)).toBe('2026-10-11');
  });

  it('phases jump to their next start', () => {
    expect(ymdOf(nextPhaseStart('planting', real))).toBe('2027-04-25');
    expect(ymdOf(nextPhaseStart('winter', real))).toBe('2026-12-05');
    const off = fastForwardOffset({ phase: 'midsummer' }, real, 0)!;
    expect(ymdOf(real + off)).toBe('2027-07-25');
  });

  it('never goes backward and stops at the limit', () => {
    expect(fastForwardOffset({ step: 'day' }, real, MAX_DEMO_OFFSET_MS)).toBeNull();
    const off = fastForwardOffset({ phase: 'winter' }, real, 0)!;
    expect(off).toBeGreaterThan(0);
  });

  it('names the current phase', () => {
    expect(currentPhase(real)).toBe('fall');
    expect(currentPhase(zonedMs('2027-01-10', 9))).toBe('winter');
    expect(currentPhase(zonedMs('2027-05-01', 9))).toBe('planting');
  });

  it('parses only known choices', () => {
    expect(parseFastForwardChoice('step:week')).toEqual({ step: 'week' });
    expect(parseFastForwardChoice('phase:fall')).toEqual({ phase: 'fall' });
    expect(parseFastForwardChoice('step:year')).toBeNull();
    expect(parseFastForwardChoice('phase:x')).toBeNull();
    expect(parseFastForwardChoice(null)).toBeNull();
  });
});
