import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  EGGS_CLEAR_MS,
  GRAZE_CLEAR_MS,
  sampleAnimalSnapshot
} from '$lib/cards/build/fixturesAnimals';
import { checkFoodLog, precheckMove, unsyncedSubjects } from './animalHold';

const at = (iso: string) => Date.parse(iso);
const NOW = at('2026-06-01T14:00:00Z');

describe('unsyncedSubjects (D1-04)', () => {
  const snapshot = sampleAnimalSnapshot();

  it('counts this Owner’s queued treatments and moves, spread over the lineage', () => {
    const set = unsyncedSubjects(
      [
        {
          ownerId: 'owner_a',
          kind: 'animal-health',
          payload: { subjectType: 'group', subjectId: 'g_layers' }
        },
        {
          ownerId: 'owner_a',
          kind: 'animal-move',
          payload: { subjectType: 'animal', subjectId: 'a_goat' }
        }
      ],
      'owner_a',
      snapshot
    );
    expect([...set].sort()).toEqual([
      'animal:a_goat',
      'animal:a_hen1',
      'animal:a_hen2',
      'group:g_layers'
    ]);
  });

  it('ignores other Owners, unassigned rows, egg logs and an unknown Owner', () => {
    const rows = [
      {
        ownerId: 'owner_b',
        kind: 'animal-health' as const,
        payload: { subjectType: 'animal', subjectId: 'a_dog' }
      },
      {
        ownerId: '__unassigned__',
        kind: 'animal-move' as const,
        payload: { subjectType: 'animal', subjectId: 'a_dog' }
      },
      {
        ownerId: 'owner_a',
        kind: 'animal-production' as const,
        payload: { subjectType: 'animal', subjectId: 'a_dog' }
      }
    ];
    expect(unsyncedSubjects(rows, 'owner_a', snapshot).size).toBe(0);
    expect(unsyncedSubjects(rows, null, snapshot).size).toBe(0);
    expect(unsyncedSubjects(rows, '__unassigned__', snapshot).size).toBe(0);
  });
});

describe('unsyncedSubjects: care-task doses and queued sprays', () => {
  const block = (id: string, areaId: string | null) => ({
    id,
    areaId,
    name: id,
    blockLabel: null,
    kind: 'block' as const,
    acres: null,
    widthFt: null,
    lengthFt: null,
    layout: null
  });
  const snapshot = {
    ...sampleAnimalSnapshot(),
    blocks: [block('b_barn', 'f_barn'), block('b_hay', 'f_hay'), block('b_loose', null)]
  } as ReturnType<typeof sampleAnimalSnapshot>;

  it('counts a care-task Done that carries a treatment as a treatment', () => {
    const set = unsyncedSubjects(
      [
        {
          ownerId: 'owner_a',
          kind: 'task',
          payload: {
            taskId: 't1',
            action: 'complete',
            healthEvent: { subjectType: 'group', subjectId: 'g_layers', kind: 'deworm' }
          }
        },
        { ownerId: 'owner_a', kind: 'task', payload: { taskId: 't2', action: 'complete' } }
      ],
      'owner_a',
      snapshot
    );
    expect([...set].sort()).toEqual(['animal:a_hen1', 'animal:a_hen2', 'group:g_layers']);
    const checked = checkFoodLog({
      snapshot: { ...snapshot, animalHolds: [], generatedAt: NOW - 60_000 },
      subject: 'group:g_layers',
      food: 'eggs',
      use: 'food',
      now: NOW,
      unsynced: set
    });
    expect(checked.verdict).toBe('unconfirmed');
  });

  it('counts a queued pesticide spray for the animals housed on that block’s Area', () => {
    for (const kind of ['herbicide', 'insecticide', 'fungicide'] as const) {
      const set = unsyncedSubjects(
        [{ ownerId: 'owner_a', kind, payload: { blockId: 'b_barn' } }],
        'owner_a',
        snapshot
      );
      expect([...set].sort()).toEqual(['animal:a_hen1', 'animal:a_hen2', 'group:g_layers']);
    }
    const hay = unsyncedSubjects(
      [{ ownerId: 'owner_a', kind: 'insecticide', payload: { blockId: 'b_hay' } }],
      'owner_a',
      snapshot
    );
    expect([...hay]).toEqual(['animal:a_goat']);
    const loose = unsyncedSubjects(
      [{ ownerId: 'owner_a', kind: 'fungicide', payload: { blockId: 'b_loose' } }],
      'owner_a',
      snapshot
    );
    expect(loose.size).toBe(0);
  });

  it('counts every housed subject for a spray on a block the snapshot does not know', () => {
    const set = unsyncedSubjects(
      [{ ownerId: 'owner_a', kind: 'herbicide', payload: { blockId: 'b_new' } }],
      'owner_a',
      snapshot
    );
    expect(set.has('group:g_layers')).toBe(true);
    expect(set.has('animal:a_goat')).toBe(true);
    expect(set.has('animal:a_dog')).toBe(false);
  });
});

describe('checkFoodLog (D1-03, D1-05)', () => {
  const snapshot = sampleAnimalSnapshot({ generatedAt: NOW - 3_600_000 });
  const base = { snapshot, subject: 'group:g_layers', food: 'eggs' as const, now: NOW };

  it('shows HOLD for food and sale, and never gates a discard', () => {
    expect(checkFoodLog({ ...base, use: 'food' }).verdict).toBe('hold');
    expect(checkFoodLog({ ...base, use: 'sale' }).verdict).toBe('hold');
    expect(checkFoodLog({ ...base, use: 'discard' }).verdict).toBe('not-gated');
    expect(checkFoodLog({ ...base, use: 'feed-to-animals' }).verdict).toBe('not-gated');
  });

  it('reads clear only once the hold ends on a fresh snapshot', () => {
    const later = EGGS_CLEAR_MS + 1;
    const fresh = sampleAnimalSnapshot({ generatedAt: later - 3_600_000 });
    expect(checkFoodLog({ ...base, snapshot: fresh, now: later, use: 'food' }).verdict).toBe(
      'clear'
    );
    const stale = sampleAnimalSnapshot({ generatedAt: later - 25 * 3_600_000 });
    const check = checkFoodLog({ ...base, snapshot: stale, now: later, use: 'food' });
    expect(check.verdict).toBe('unconfirmed');
    expect(check.reading?.unconfirmedReason).toBe('stale');
  });

  it('can’t confirm with no snapshot, other rules or an unsynced treatment', () => {
    expect(checkFoodLog({ ...base, snapshot: null, use: 'food' }).verdict).toBe('unconfirmed');
    const hen2 = { ...base, subject: 'animal:a_hen2', use: 'food' as const };
    expect(checkFoodLog(hen2).verdict).toBe('clear');
    expect(checkFoodLog({ ...hen2, rulesVersion: '0.0.0-other' }).verdict).toBe('unconfirmed');
    expect(
      checkFoodLog({ ...hen2, unsynced: new Set(['group:g_layers']) }).reading?.unconfirmedReason
    ).toBe('unsynced');
  });

  it('never reads clear while any hold span is open (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: at('2026-05-01T00:00:00Z'), max: at('2026-07-01T00:00:00Z') }),
        fc.boolean(),
        (now, stale) => {
          const snap = sampleAnimalSnapshot({ generatedAt: stale ? now - 30 * 3_600_000 : now });
          const open = (snap.animalHolds ?? []).some(
            (h) =>
              h.subject === 'group:g_layers' &&
              h.food === 'eggs' &&
              (h.clearMs === null || h.clearMs > now)
          );
          const v = checkFoodLog({ ...base, snapshot: snap, now, use: 'food' }).verdict;
          if (open) expect(v).toBe('hold');
          else expect(v).not.toBe('hold');
          if (stale) expect(v).not.toBe('clear');
        }
      )
    );
  });
});

describe('precheckMove (D1-06, D2-02)', () => {
  const snapshot = sampleAnimalSnapshot();
  const base = { snapshot, subjectType: 'group' as const, subjectId: 'g_layers', now: NOW };

  it('stops food animals headed for a held pasture, with Ask the owner for a helper', () => {
    const helper = precheckMove({ ...base, fieldId: 'f_hay', role: 'helper' });
    expect(helper.verdict).toBe('stop');
    expect(helper.verdict === 'stop' && helper.message).toContain('Ask the owner.');
    const owner = precheckMove({ ...base, fieldId: 'f_hay', role: 'owner' });
    expect(owner.verdict === 'stop' && owner.message).not.toContain('Ask the owner');
  });

  it('only warns for a pet, and passes once the hold is over or with no hold on file', () => {
    expect(
      precheckMove({
        ...base,
        subjectType: 'animal',
        subjectId: 'a_dog',
        fieldId: 'f_hay',
        role: 'helper'
      }).verdict
    ).toBe('warn');
    expect(
      precheckMove({ ...base, fieldId: 'f_hay', role: 'helper', now: GRAZE_CLEAR_MS + 1 }).verdict
    ).toBe('ok');
    expect(precheckMove({ ...base, fieldId: 'nowhere', role: 'helper' }).verdict).toBe('ok');
    expect(
      precheckMove({ ...base, snapshot: null, fieldId: 'f_hay', role: 'helper' }).verdict
    ).toBe('ok');
  });

  it('treats an animal missing from the snapshot as a food animal', () => {
    expect(
      precheckMove({
        ...base,
        subjectType: 'animal',
        subjectId: 'new',
        fieldId: 'f_hay',
        role: 'owner'
      }).verdict
    ).toBe('stop');
  });
});
