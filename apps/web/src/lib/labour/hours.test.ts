import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatHours, isTaskMinutes, sumMinutes, totalMinutes } from './hours';

describe('sumMinutes (F1-18)', () => {
  const rows = [
    { minutes: 30, cropId: 'c1', userId: 'u1', fieldId: 'f1' },
    { minutes: 45, cropId: 'c1', userId: 'u2', fieldId: 'f1' },
    { minutes: 15, cropId: null, userId: 'u1', fieldId: null },
    { minutes: -5, cropId: 'c2', userId: 'u1', fieldId: 'f2' }
  ];
  it('groups by crop, person or field and drops rows without that link', () => {
    expect([...sumMinutes(rows, 'crop')]).toEqual([['c1', 75]]);
    expect([...sumMinutes(rows, 'user')]).toEqual([
      ['u1', 45],
      ['u2', 45]
    ]);
    expect([...sumMinutes(rows, 'field')]).toEqual([['f1', 75]]);
  });

  it('per-person totals add up to the whole', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            minutes: fc.integer({ min: 1, max: 720 }),
            userId: fc.constantFrom('a', 'b', 'c')
          })
        ),
        (rs) => {
          const byUser = [...sumMinutes(rs, 'user').values()].reduce((a, b) => a + b, 0);
          expect(byUser).toBe(totalMinutes(rs));
        }
      )
    );
  });
});

describe('formatHours', () => {
  it('reads as minutes up to an hour, then quarter hours', () => {
    expect(formatHours(0)).toBe('0 min');
    expect(formatHours(45)).toBe('45 min');
    expect(formatHours(60)).toBe('1 h');
    expect(formatHours(90)).toBe('1.5 h');
    expect(formatHours(130)).toBe('2.25 h');
    expect(formatHours(390)).toBe('6.5 h');
    expect(formatHours(720)).toBe('12 h');
  });
});

describe('isTaskMinutes', () => {
  it('takes whole minutes from 1 to 720', () => {
    for (const ok of [1, 30, 720]) expect(isTaskMinutes(ok)).toBe(true);
    for (const bad of [0, 721, 1.5, -1, Number.NaN, '30', undefined])
      expect(isTaskMinutes(bad)).toBe(false);
  });
});
