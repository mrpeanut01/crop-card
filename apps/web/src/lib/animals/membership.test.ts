import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  lineageFromStays,
  membershipsFromStays,
  withInheritedLineage,
  type MembershipStay
} from './membership';
import {
  evaluateFoodUse,
  physicalWindow,
  type GroupMembership,
  type TreatmentRecord
} from '$lib/safety/animalWithdrawal';

function groupAt(ms: readonly GroupMembership[], at: number): string[] {
  return ms
    .filter((m) => (m.fromMs ?? -Infinity) <= at && (m.toMs === null || at < m.toMs))
    .map((m) => m.groupId);
}

describe('membershipsFromStays (C-15)', () => {
  it('reads a grouped animal with no moves as a member since before any record', () => {
    expect(membershipsFromStays('g1', [])).toEqual([{ groupId: 'g1', fromMs: null, toMs: null }]);
    expect(membershipsFromStays(null, [])).toEqual([]);
  });

  it('follows a hen out of the flock to her own pen and back in', () => {
    const stays: MembershipStay[] = [
      { fromMs: 100, toMs: 200, fromGroupId: 'flock', toGroupId: 'flock' }
    ];
    expect(membershipsFromStays('flock', stays)).toEqual([
      { groupId: 'flock', fromMs: null, toMs: 100 },
      { groupId: 'flock', fromMs: 200, toMs: null }
    ]);
  });

  it('reads a split marker as leaving one group and joining the other', () => {
    const stays: MembershipStay[] = [{ fromMs: 50, toMs: 50, fromGroupId: 'a', toGroupId: 'b' }];
    expect(membershipsFromStays('b', stays)).toEqual([
      { groupId: 'a', fromMs: null, toMs: 50 },
      { groupId: 'b', fromMs: 50, toMs: null }
    ]);
  });

  it('keeps both readings when the history disagrees with the current group', () => {
    const stays: MembershipStay[] = [{ fromMs: 50, toMs: 50, fromGroupId: 'a', toGroupId: 'b' }];
    const out = membershipsFromStays('c', stays);
    expect(groupAt(out, 60).sort()).toEqual(['b', 'c']);
  });

  type Step = { kind: 'to-group'; group: string } | { kind: 'to-area' };

  const stepArb: fc.Arbitrary<Step> = fc.oneof(
    fc.constantFrom('a', 'b', 'c').map((group) => ({ kind: 'to-group' as const, group })),
    fc.constant({ kind: 'to-area' as const })
  );

  it('matches a simulated move history at every moment', () => {
    fc.assert(
      fc.property(
        fc.option(fc.constantFrom('a', 'b', 'c'), { nil: null }),
        fc.array(fc.tuple(stepArb, fc.integer({ min: 1, max: 50 })), { maxLength: 12 }),
        (start, steps) => {
          const rows: MembershipStay[] = [];
          let group: string | null = start;
          let t = 1000;
          if (group === null)
            rows.push({ fromMs: t, toMs: null, fromGroupId: null, toGroupId: null });
          const truth: Array<{ from: number; group: string | null }> = [{ from: -Infinity, group }];
          const open = () => rows.find((r) => r.toMs === null);
          for (const [step, gap] of steps) {
            t += gap;
            if (step.kind === 'to-group') {
              if (step.group === group) continue;
              if (group === null) {
                const o = open()!;
                o.toMs = t;
                o.toGroupId = step.group;
              } else {
                rows.push({ fromMs: t, toMs: t, fromGroupId: group, toGroupId: step.group });
              }
              group = step.group;
            } else {
              const o = open();
              if (o) o.toMs = t;
              rows.push({ fromMs: t, toMs: null, fromGroupId: group, toGroupId: null });
              group = null;
            }
            truth.push({ from: t, group });
          }
          const ms = membershipsFromStays(group, rows);
          for (let i = 0; i < truth.length; i++) {
            const probe = i === 0 ? 999 : truth[i].from;
            const expected = truth[i].group;
            expect(groupAt(ms, probe)).toEqual(expected ? [expected] : []);
          }
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('lineageFromStays (B-07 splits)', () => {
  it('carries the parent and grandparent up to the split', () => {
    const own: MembershipStay[] = [
      { fromMs: 500, toMs: null, fromGroupId: 'parent', toGroupId: null }
    ];
    const parents: Record<string, MembershipStay[]> = {
      parent: [{ fromMs: 300, toMs: null, fromGroupId: 'grand', toGroupId: null }]
    };
    expect(lineageFromStays(own, (g) => parents[g] ?? [])).toEqual([
      { groupId: 'parent', fromMs: null, toMs: 500 },
      { groupId: 'grand', fromMs: null, toMs: 300 }
    ]);
  });

  it('stops on a cycle and keeps each parent once', () => {
    const loop: MembershipStay[] = [{ fromMs: 1, toMs: null, fromGroupId: 'x', toGroupId: null }];
    expect(lineageFromStays(loop, () => loop)).toEqual([{ groupId: 'x', fromMs: null, toMs: 1 }]);
  });

  it('keeps the widest window when a parent is reached twice', () => {
    const own: MembershipStay[] = [
      { fromMs: 100, toMs: null, fromGroupId: 'a', toGroupId: null },
      { fromMs: 900, toMs: null, fromGroupId: 'b', toGroupId: null }
    ];
    const parents: Record<string, MembershipStay[]> = {
      a: [{ fromMs: 50, toMs: null, fromGroupId: 'root', toGroupId: null }],
      b: [{ fromMs: 800, toMs: null, fromGroupId: 'root', toGroupId: null }]
    };
    const out = lineageFromStays(own, (g) => parents[g] ?? []);
    expect(out.find((m) => m.groupId === 'root')).toEqual({
      groupId: 'root',
      fromMs: null,
      toMs: 800
    });
  });
});

describe('withInheritedLineage (round 7)', () => {
  const SPLIT = 1_000;
  const lineageOf = (g: string): GroupMembership[] =>
    g === 'child' ? [{ groupId: 'parent', fromMs: null, toMs: SPLIT }] : [];
  const dose = (atMs: number): TreatmentRecord => ({
    id: `t${atMs}`,
    subjectType: 'group',
    subjectId: 'parent',
    speciesId: 'chicken',
    kind: 'deworm',
    productPluginId: null,
    productName: 'Wormer X',
    route: null,
    labelUse: null,
    administeredAtMs: atMs,
    courseEndAtMs: null,
    entries: []
  });
  const verdict = (memberships: GroupMembership[], doseAt: number) =>
    evaluateFoodUse({
      subject: { type: 'animal', id: 'henny', memberships },
      food: 'eggs',
      use: 'sale',
      atMs: 5_000,
      treatments: [dose(doseAt)],
      plugins: () => undefined
    }).status;

  it("carries the parent group's split window down to a member of the child group", () => {
    const out = withInheritedLineage([{ groupId: 'child', fromMs: null, toMs: null }], lineageOf);
    expect(out).toContainEqual({
      groupId: 'parent',
      fromMs: null,
      toMs: null,
      inheritedUntilMs: SPLIT
    });
    expect(physicalWindow(out[1])).toEqual({ groupId: 'parent', fromMs: null, toMs: SPLIT });
  });

  it('property: a parent dose reaches the child member exactly when given at or before the split', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_000 }),
        fc.integer({ min: 0, max: 4_000 }),
        (doseAt, joinAt) => {
          const ms = withInheritedLineage(
            [{ groupId: 'child', fromMs: joinAt, toMs: null }],
            lineageOf
          );
          expect(verdict(ms, doseAt)).toBe(doseAt <= SPLIT ? 'block' : 'safe');
        }
      )
    );
  });
});
