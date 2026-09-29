import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lineageFromStays, membershipsFromStays, type MembershipStay } from './membership';

const membershipsOf = (rows: readonly MembershipStay[], current: string | null) =>
  membershipsFromStays(current, rows);
const lineageOf = (id: string, stays: (g: string) => readonly MembershipStay[]) =>
  lineageFromStays(stays(id), stays, id);

const row = (over: Partial<MembershipStay>): MembershipStay => ({
  fromMs: 0,
  toMs: null,
  fromGroupId: null,
  toGroupId: null,
  ...over
});

const covers = (ms: ReturnType<typeof membershipsOf>, groupId: string, at: number) =>
  ms.some(
    (m) =>
      m.groupId === groupId &&
      (m.fromMs === null || m.fromMs <= at) &&
      (m.toMs === null || at < m.toMs)
  );

describe('membershipsFromStays, C4 cases', () => {
  it('reads an animal created in its group as a member from before any record', () => {
    expect(membershipsOf([], 'g1')).toEqual([{ groupId: 'g1', fromMs: null, toMs: null }]);
  });

  it('ends the membership when the animal moves to an Area on its own', () => {
    const m = membershipsOf([row({ fromMs: 100, fromGroupId: 'g1' })], null);
    expect(m).toEqual([{ groupId: 'g1', fromMs: null, toMs: 100 }]);
  });

  it('starts the membership when an ungrouped animal joins a group', () => {
    const m = membershipsOf([row({ fromMs: 10, toMs: 100, toGroupId: 'g2' })], 'g2');
    expect(m).toEqual([{ groupId: 'g2', fromMs: 100, toMs: null }]);
  });

  it('follows a marker from one group to another', () => {
    const m = membershipsOf(
      [row({ fromMs: 50, toMs: 50, fromGroupId: 'g1', toGroupId: 'g2' })],
      'g2'
    );
    expect(covers(m, 'g1', 49)).toBe(true);
    expect(covers(m, 'g1', 50)).toBe(false);
    expect(covers(m, 'g2', 50)).toBe(true);
    expect(covers(m, 'g2', 49)).toBe(false);
  });

  it('keeps both readings when the rows and the current group disagree', () => {
    const m = membershipsOf(
      [row({ fromMs: 50, toMs: 50, fromGroupId: 'g1', toGroupId: 'g2' })],
      'g3'
    );
    expect(covers(m, 'g2', 60)).toBe(true);
    expect(covers(m, 'g3', 60)).toBe(true);
  });

  it('marks every recorded membership whatever order the changes arrive in', () => {
    const groups = ['g1', 'g2', 'g3'];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            at: fc.integer({ min: 1, max: 1000 }),
            to: fc.constantFrom(...groups)
          }),
          { minLength: 1, maxLength: 6 }
        ),
        (steps) => {
          const sorted = [...steps].sort((a, b) => a.at - b.at);
          const unique = sorted.filter((s, i) => i === 0 || s.at !== sorted[i - 1].at);
          let prev = 'g0';
          const rows: MembershipStay[] = [];
          for (const s of unique) {
            rows.push(row({ fromMs: s.at, toMs: s.at, fromGroupId: prev, toGroupId: s.to }));
            prev = s.to;
          }
          const m = membershipsOf([...rows].reverse(), prev);
          let current = 'g0';
          for (let t = 0; t <= 1001; t += 7) {
            for (const s of unique) if (s.at <= t) current = s.to;
            expect(covers(m, current, t)).toBe(true);
            current = 'g0';
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('lineageFromStays, C4 cases', () => {
  it('carries the parent up to the split, and the grandparent no further than the parent', () => {
    const stays: Record<string, MembershipStay[]> = {
      child: [row({ fromMs: 300, fromGroupId: 'parent' })],
      parent: [row({ fromMs: 100, fromGroupId: 'grand' })],
      grand: [row({ fromMs: 0 })]
    };
    expect(lineageOf('child', (id) => stays[id] ?? [])).toEqual([
      { groupId: 'parent', fromMs: null, toMs: 300 },
      { groupId: 'grand', fromMs: null, toMs: 100 }
    ]);
  });

  it('stops on a loop', () => {
    const stays: Record<string, MembershipStay[]> = {
      a: [row({ fromMs: 10, fromGroupId: 'b' })],
      b: [row({ fromMs: 5, fromGroupId: 'a' })]
    };
    expect(lineageOf('a', (id) => stays[id] ?? [])).toEqual([
      { groupId: 'b', fromMs: null, toMs: 10 }
    ]);
  });
});
