import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DELETED_BEFORE_REVIEW,
  organicUseFactLine,
  projectAnimalOrganic,
  treatmentOutcomeText,
  type AnimalOrganicSubject,
  type AnimalOrganicWorld,
  type OrganicTreatmentInput
} from './animalStatus';
import { NOP_RULES } from './nopRules';
import { isUnderOrganic, type OrganicStatus, type OrganicStatusEntry } from './status';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

function entry(
  type: 'animal' | 'group',
  id: string,
  status: OrganicStatus,
  day: number,
  createdDay = day
): OrganicStatusEntry {
  return {
    id: `${type}-${id}-${day}-${status}`,
    subjectType: type,
    subjectId: id,
    status,
    effectiveAt: T0 + day * DAY,
    certifier: null,
    note: null,
    createdBy: null,
    createdAt: T0 + createdDay * DAY,
    documentIds: []
  };
}

interface Membership {
  animalId: string;
  groupId: string;
  fromDay: number;
  toDay: number | null;
}

function world(
  entries: OrganicStatusEntry[],
  memberships: Membership[] = [],
  overrides: Partial<AnimalOrganicWorld> = {}
): AnimalOrganicWorld {
  const inWindow = (m: Membership, from: number, to: number) =>
    T0 + m.fromDay * DAY <= to && (m.toDay === null || T0 + m.toDay * DAY > from);
  return {
    entries: (s: AnimalOrganicSubject) =>
      entries.filter((e) => e.subjectType === s.type && e.subjectId === s.id),
    groupName: (id) => `Group ${id}`,
    groupsAt: (animalId, at) =>
      memberships
        .filter((m) => m.animalId === animalId && inWindow(m, at, at))
        .map((m) => m.groupId),
    membersDuring: (groupId, from, to) =>
      memberships
        .filter((m) => m.groupId === groupId && inWindow(m, from, to))
        .map((m) => m.animalId),
    plugin: () => undefined,
    rules: NOP_RULES,
    ...overrides
  };
}

function dose(
  id: string,
  subjectType: 'animal' | 'group',
  subjectId: string,
  day: number,
  extra: Partial<OrganicTreatmentInput> = {}
): OrganicTreatmentInput {
  return {
    healthEventId: id,
    subjectType,
    subjectId,
    administeredAt: T0 + day * DAY,
    courseEndAt: null,
    product: 'Dewormer',
    pluginId: null,
    deleted: false,
    review: null,
    ...extra
  };
}

const review = (outcome: 'status-lost' | 'not-affected', day = 0) => ({
  outcome,
  reason: 'Owner checked with the certifier.',
  createdAt: T0 + day * DAY,
  lockedAt: null,
  by: null
});

describe('outcomes (B-22, B-23, O-08, O-09)', () => {
  it('needs review until the owner answers', () => {
    const w = world([entry('animal', 'hen', 'organic', 0)]);
    const p = projectAnimalOrganic([dose('h1', 'animal', 'hen', 10)], w);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].outcome).toBe('needs-review');
    expect(p.rows[0].basis).toBeNull();
    expect(isUnderOrganic(p.statusAt({ type: 'animal', id: 'hen' }, T0 + 20 * DAY))).toBe(true);
  });

  it('status lost when the owner says so, from the dose date', () => {
    const w = world([entry('animal', 'hen', 'organic', 0)]);
    const p = projectAnimalOrganic(
      [dose('h1', 'animal', 'hen', 10, { review: review('status-lost') })],
      w
    );
    expect(p.rows[0].outcome).toBe('status-lost');
    expect(p.rows[0].basis).toBe('owner-review');
    const hen = { type: 'animal' as const, id: 'hen' };
    expect(isUnderOrganic(p.statusAt(hen, T0 + 9 * DAY))).toBe(true);
    expect(p.statusAt(hen, T0 + 10 * DAY)?.lost?.healthEventId).toBe('h1');
  });

  it('not affected only by the owner answer', () => {
    const w = world([entry('animal', 'hen', 'transitioning', 0)]);
    const p = projectAnimalOrganic(
      [dose('h1', 'animal', 'hen', 10, { review: review('not-affected') })],
      w
    );
    expect(p.rows[0].outcome).toBe('not-affected');
    expect(p.losses.size).toBe(0);
  });

  it('antibiotics still need review while the rule is off', () => {
    const w = world([entry('animal', 'cow', 'organic', 0)], [], {
      plugin: () => ({ productKind: 'antibiotic' })
    });
    const p = projectAnimalOrganic([dose('h1', 'animal', 'cow', 5, { pluginId: 'x' })], w);
    expect(p.rows[0].outcome).toBe('needs-review');
  });

  it('antibiotics and sourced not-allowed products are a loss once the rule is on', () => {
    const rules = { ...NOP_RULES, treatedAnimalRule: true };
    const abx = world([entry('animal', 'cow', 'organic', 0)], [], {
      plugin: () => ({ productKind: 'antibiotic' }),
      rules
    });
    const p = projectAnimalOrganic(
      [dose('h1', 'animal', 'cow', 5, { pluginId: 'x', review: review('not-affected') })],
      abx
    );
    expect(p.rows[0]).toMatchObject({ outcome: 'status-lost', basis: 'rule' });

    const notAllowed = world([entry('animal', 'cow', 'organic', 0)], [], {
      plugin: () => ({
        productKind: 'antiparasitic',
        organicUse: { status: 'not-allowed', citation: 'x' }
      }),
      rules
    });
    expect(
      projectAnimalOrganic([dose('h1', 'animal', 'cow', 5, { pluginId: 'x' })], notAllowed).rows[0]
        .outcome
    ).toBe('status-lost');

    const allowed = world([entry('animal', 'cow', 'organic', 0)], [], {
      plugin: () => ({
        productKind: 'antiparasitic',
        organicUse: { status: 'allowed', citation: 'x' }
      }),
      rules
    });
    expect(
      projectAnimalOrganic([dose('h1', 'animal', 'cow', 5, { pluginId: 'x' })], allowed).rows[0]
        .outcome
    ).toBe('needs-review');
  });

  it('ignores a dose before the status took effect and a subject with none', () => {
    const w = world([entry('animal', 'hen', 'organic', 20)]);
    expect(projectAnimalOrganic([dose('h1', 'animal', 'hen', 10)], w).rows).toEqual([]);
    expect(projectAnimalOrganic([dose('h1', 'animal', 'dog', 10)], w).rows).toEqual([]);
  });

  it('ignores a not-organic status', () => {
    const w = world([entry('animal', 'hen', 'not-organic', 0)]);
    expect(projectAnimalOrganic([dose('h1', 'animal', 'hen', 10)], w).rows).toEqual([]);
  });
});

describe('library organic-use fact (B-23)', () => {
  it('carries an allowed entry beside the question without deciding it', () => {
    const fact = {
      status: 'allowed-with-conditions' as const,
      citation: '7 CFR 205.603(a)',
      conditions: 'Only in an emergency'
    };
    const w = world([entry('animal', 'hen', 'organic', 0)], [], {
      plugin: (id) =>
        id === 'ok'
          ? { productKind: 'vaccine', organicUse: fact }
          : { productKind: 'dewormer', organicUse: { status: 'not-allowed', citation: 'x' } }
    });
    const p = projectAnimalOrganic(
      [
        dose('h1', 'animal', 'hen', 10, { pluginId: 'ok' }),
        dose('h2', 'animal', 'hen', 11, { pluginId: 'no' })
      ],
      w
    );
    expect(p.rows[0]).toMatchObject({ outcome: 'needs-review', organicUse: fact });
    expect(p.rows[1].organicUse).toBeNull();
    expect(organicUseFactLine(fact)).toBe(
      'Library entry: allowed for organic use with conditions (7 CFR 205.603(a)). Conditions: Only in an emergency. This is a fact to weigh, not the answer.'
    );
  });
});

describe('reach (B-24)', () => {
  const members: Membership[] = [
    { animalId: 'a', groupId: 'flock', fromDay: 0, toDay: null },
    { animalId: 'b', groupId: 'flock', fromDay: 0, toDay: 8 },
    { animalId: 'late', groupId: 'flock', fromDay: 30, toDay: null }
  ];

  it('a group treatment reaches the group and members at the time', () => {
    const w = world([entry('group', 'flock', 'organic', 0)], members);
    const p = projectAnimalOrganic(
      [dose('h1', 'group', 'flock', 10, { review: review('status-lost') })],
      w
    );
    expect(p.rows[0].subjects).toEqual([
      { type: 'group', id: 'flock' },
      { type: 'animal', id: 'a' }
    ]);
    expect(p.losses.has('animal:a')).toBe(true);
    expect(p.losses.has('animal:b')).toBe(false);
  });

  it('a course end widens the reach', () => {
    const w = world(
      [entry('group', 'flock', 'organic', 0), entry('animal', 'late', 'organic', 0)],
      members
    );
    const short = projectAnimalOrganic([dose('h1', 'group', 'flock', 10)], w);
    expect(short.rows[0].subjects.map((s) => s.id).sort()).toEqual(['a', 'flock']);
    const long = projectAnimalOrganic(
      [dose('h1', 'group', 'flock', 10, { courseEndAt: T0 + 35 * DAY })],
      w
    );
    expect(long.rows[0].subjects.map((s) => s.id).sort()).toEqual(['a', 'flock', 'late']);
  });

  it('a member joining after the treatment is not reached, but inherits the group', () => {
    const w = world(
      [entry('group', 'flock', 'organic', 0), entry('animal', 'late2', 'organic', 0)],
      [...members, { animalId: 'late2', groupId: 'flock', fromDay: 30, toDay: null }]
    );
    const p = projectAnimalOrganic(
      [dose('h1', 'group', 'flock', 10, { review: review('status-lost') })],
      w
    );
    expect(p.rows[0].subjects.map((s) => s.id)).not.toContain('late');
    expect(p.losses.has('animal:late')).toBe(false);
    const late = p.statusAt({ type: 'animal', id: 'late' }, T0 + 40 * DAY);
    expect(late?.inheritedFrom?.name).toBe('Group flock');
    expect(late?.lost).not.toBeNull();
    expect(isUnderOrganic(p.statusAt({ type: 'animal', id: 'late2' }, T0 + 40 * DAY))).toBe(true);
  });

  it('an individual treatment never changes its group', () => {
    const w = world([entry('group', 'flock', 'organic', 0)], members);
    const p = projectAnimalOrganic(
      [dose('h1', 'animal', 'a', 10, { review: review('status-lost') })],
      w
    );
    expect(p.losses.has('animal:a')).toBe(true);
    expect(p.losses.has('group:flock')).toBe(false);
    expect(isUnderOrganic(p.statusAt({ type: 'group', id: 'flock' }, T0 + 20 * DAY))).toBe(true);
  });
});

describe('one-way loss (O-10) and deleted doses (B-26)', () => {
  it('a later entry does not restore a lost animal', () => {
    const w = world([entry('animal', 'hen', 'organic', 0), entry('animal', 'hen', 'organic', 50)]);
    const p = projectAnimalOrganic(
      [dose('h1', 'animal', 'hen', 10, { review: review('status-lost') })],
      w
    );
    expect(isUnderOrganic(p.statusAt({ type: 'animal', id: 'hen' }, T0 + 60 * DAY))).toBe(false);
  });

  it('backdated entries added after the answer do not erase a confirmed loss', () => {
    const hen = { type: 'animal' as const, id: 'hen' };
    const doses = [dose('h1', 'animal', 'hen', 59, { review: review('status-lost', 59) })];
    const before = projectAnimalOrganic(doses, world([entry('animal', 'hen', 'organic', 0)]));
    expect(before.rows).toHaveLength(1);
    const after = projectAnimalOrganic(
      doses,
      world([
        entry('animal', 'hen', 'organic', 0),
        entry('animal', 'hen', 'not-organic', 59, 130),
        entry('animal', 'hen', 'organic', 60, 130)
      ])
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]).toMatchObject({ outcome: 'status-lost', basis: 'owner-review' });
    expect(after.statusAt(hen, T0 + 140 * DAY)?.lost?.healthEventId).toBe('h1');
    expect(isUnderOrganic(after.statusAt(hen, T0 + 140 * DAY))).toBe(false);
  });

  it('a backdated group entry does not drop members from an answered review', () => {
    const doses = [dose('g1', 'group', 'flock', 30, { review: review('status-lost', 31) })];
    const m = [{ animalId: 'hen', groupId: 'flock', fromDay: 0, toDay: null }];
    const p = projectAnimalOrganic(
      doses,
      world(
        [entry('group', 'flock', 'organic', 0), entry('group', 'flock', 'not-organic', 20, 90)],
        m
      )
    );
    expect(p.rows[0].subjects.map((s) => `${s.type}:${s.id}`).sort()).toEqual([
      'animal:hen',
      'group:flock'
    ]);
    expect(p.losses.has('animal:hen')).toBe(true);
  });

  it('a second dose after the loss is not asked about again', () => {
    const w = world([entry('animal', 'hen', 'organic', 0)]);
    const p = projectAnimalOrganic(
      [
        dose('h1', 'animal', 'hen', 10, { review: review('status-lost') }),
        dose('h2', 'animal', 'hen', 20)
      ],
      w
    );
    expect(p.rows.map((r) => r.healthEventId)).toEqual(['h1']);
  });

  it('a deleted dose keeps its answer, and without one says so', () => {
    const w = world([entry('animal', 'hen', 'organic', 0)]);
    const kept = projectAnimalOrganic(
      [dose('h1', 'animal', 'hen', 10, { deleted: true, review: review('status-lost') })],
      w
    );
    expect(kept.rows[0]).toMatchObject({ outcome: 'status-lost', deleted: true });
    const open = projectAnimalOrganic([dose('h1', 'animal', 'hen', 10, { deleted: true })], w);
    expect(treatmentOutcomeText(open.rows[0])).toBe(DELETED_BEFORE_REVIEW);
  });

  it('a loss is never undone by adding treatments or entries (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 100 }), { maxLength: 6 }),
        fc.array(
          fc.tuple(
            fc.integer({ min: 6, max: 100 }),
            fc.constantFrom<OrganicStatus>('organic', 'transitioning', 'not-organic')
          ),
          { maxLength: 4 }
        ),
        (extraDays, extraEntries) => {
          const base = [entry('animal', 'hen', 'organic', 0)];
          const lost = [dose('h0', 'animal', 'hen', 5, { review: review('status-lost') })];
          const more = extraDays.map((d, i) => dose(`x${i}`, 'animal', 'hen', d));
          const entries = [...base, ...extraEntries.map(([d, s]) => entry('animal', 'hen', s, d))];
          const p = projectAnimalOrganic([...lost, ...more], world(entries));
          return !isUnderOrganic(p.statusAt({ type: 'animal', id: 'hen' }, T0 + 200 * DAY));
        }
      )
    );
  });
});
