import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isNonOverlapping, openStay, planStayInsert, stayAt, type Stay } from './timeline';

function apply(stays: Stay[], id: string, at: number): Stay[] {
  const plan = planStayInsert(stays, at);
  if (!plan.ok) return stays;
  const next = stays.map((s) =>
    plan.truncate && s.id === plan.truncate.id ? { ...s, toMs: plan.truncate.toMs } : s
  );
  next.push({ id, fromMs: at, toMs: plan.toMs });
  return next;
}

describe('planStayInsert', () => {
  it('opens the first stay', () => {
    expect(planStayInsert([], 100)).toEqual({ ok: true, truncate: null, toMs: null });
  });

  it('closes the open stay when a later move arrives', () => {
    const stays: Stay[] = [{ id: 'a', fromMs: 100, toMs: null }];
    expect(planStayInsert(stays, 200)).toEqual({
      ok: true,
      truncate: { id: 'a', toMs: 200 },
      toMs: null
    });
  });

  it('slots a backdated move between two stays', () => {
    const stays: Stay[] = [
      { id: 'a', fromMs: 100, toMs: 300 },
      { id: 'b', fromMs: 300, toMs: null }
    ];
    expect(planStayInsert(stays, 200)).toEqual({
      ok: true,
      truncate: { id: 'a', toMs: 200 },
      toMs: 300
    });
  });

  it('ends a move dated before every stay where the first stay begins', () => {
    const stays: Stay[] = [{ id: 'a', fromMs: 500, toMs: null }];
    expect(planStayInsert(stays, 100)).toEqual({ ok: true, truncate: null, toMs: 500 });
  });

  it('does not stretch a stay across a gap', () => {
    const stays: Stay[] = [
      { id: 'a', fromMs: 100, toMs: 200 },
      { id: 'b', fromMs: 400, toMs: null }
    ];
    expect(planStayInsert(stays, 150)).toEqual({
      ok: true,
      truncate: { id: 'a', toMs: 150 },
      toMs: 200
    });
    expect(planStayInsert(stays, 300)).toEqual({ ok: true, truncate: null, toMs: 400 });
  });

  it('refuses two stays starting at the same moment', () => {
    expect(planStayInsert([{ id: 'a', fromMs: 100, toMs: null }], 100)).toEqual({
      ok: false,
      reason: 'same-time'
    });
  });

  it('ignores zero-length group-change markers', () => {
    const stays: Stay[] = [
      { id: 'a', fromMs: 100, toMs: null },
      { id: 'm', fromMs: 150, toMs: 150 }
    ];
    expect(planStayInsert(stays, 150).ok).toBe(true);
    expect(stayAt(stays, 150)?.id).toBe('a');
  });

  it('keeps every timeline non-overlapping under random interleaved moves', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 40 }),
        (times) => {
          let stays: Stay[] = [];
          times.forEach((t, i) => {
            stays = apply(stays, `s${i}`, t);
          });
          expect(isNonOverlapping(stays)).toBe(true);
          const distinct = new Set(times);
          expect(stays).toHaveLength(distinct.size);
          const latest = Math.max(...times);
          expect(openStay(stays)?.fromMs).toBe(latest);
          for (const t of distinct) expect(stayAt(stays, t)?.fromMs).toBe(t);
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('isNonOverlapping', () => {
  it('flags two open stays and overlaps', () => {
    expect(
      isNonOverlapping([
        { id: 'a', fromMs: 1, toMs: null },
        { id: 'b', fromMs: 2, toMs: null }
      ])
    ).toBe(false);
    expect(
      isNonOverlapping([
        { id: 'a', fromMs: 1, toMs: 5 },
        { id: 'b', fromMs: 3, toMs: null }
      ])
    ).toBe(false);
  });
});
