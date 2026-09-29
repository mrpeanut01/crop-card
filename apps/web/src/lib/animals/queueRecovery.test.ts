import { describe, expect, it } from 'vitest';
import {
  deleteConfirmText,
  lineageKeys,
  payloadSubjectKeys,
  pendingSummary,
  recoveryFor,
  rejectInfoOf,
  rewriteForRecovery
} from './queueRecovery';

const eggs = {
  subjectType: 'group',
  subjectId: 'g1',
  kind: 'eggs',
  quantity: 12,
  unit: 'eggs',
  use: 'food',
  occurredAt: 1_000
};

describe('rejectInfoOf', () => {
  it('keeps only the fields the recovery reads', () => {
    expect(
      rejectInfoOf(
        JSON.stringify({
          code: 'WITHDRAWAL_UNKNOWN',
          error: 'On hold.',
          askOwner: true,
          resubmitAs: 'discard',
          products: ['x']
        })
      )
    ).toEqual({
      code: 'WITHDRAWAL_UNKNOWN',
      error: 'On hold.',
      askOwner: true,
      resubmitAs: 'discard'
    });
  });

  it('reads nothing from a body that is not JSON or has none of them', () => {
    expect(rejectInfoOf('rejected')).toBeUndefined();
    expect(rejectInfoOf('[1]')).toBeUndefined();
    expect(rejectInfoOf('{"x":1}')).toBeUndefined();
  });
});

describe('recoveryFor (D1-07)', () => {
  it('offers Save as discard as the one primary action for a refused food log', () => {
    expect(
      recoveryFor({
        kind: 'animal-production',
        lastStatus: 422,
        rejectInfo: { code: 'WITHDRAWAL_ACTIVE', resubmitAs: 'discard' },
        payload: eggs
      })
    ).toEqual({ primary: 'save-as-discard', actions: ['save-as-discard'], askOwner: false });
  });

  it('offers Keep animals here or They already went through the gate for a grazing stop', () => {
    const r = recoveryFor({
      kind: 'animal-move',
      lastStatus: 422,
      rejectInfo: { code: 'GRAZING_INTERVAL' },
      payload: {}
    });
    expect(r.primary).toBe('keep-here');
    expect(r.actions).toEqual(['keep-here', 'already-went']);
    expect(r.askOwner).toBe(false);
    const helper = recoveryFor({
      kind: 'animal-move',
      lastStatus: 422,
      rejectInfo: { code: 'GRAZING_UNKNOWN', askOwner: true },
      payload: {}
    });
    expect(helper.actions).toEqual(['keep-here']);
    expect(helper.askOwner).toBe(true);
  });

  it('maps OUT_OF_ORDER and STAY_HAS_GRAZING_HOLD to re-dating', () => {
    expect(
      recoveryFor({
        kind: 'animal-health',
        lastStatus: 409,
        rejectInfo: { code: 'OUT_OF_ORDER' },
        payload: {}
      }).actions
    ).toEqual(['record-now']);
    expect(
      recoveryFor({
        kind: 'animal-move',
        lastStatus: 409,
        rejectInfo: { code: 'STAY_HAS_GRAZING_HOLD' },
        payload: {}
      }).actions
    ).toEqual(['redate', 'record-now']);
  });

  it('parks a 403 for the owner and offers only Retry for anything else', () => {
    expect(recoveryFor({ kind: 'animal-health', lastStatus: 403, payload: {} })).toEqual({
      primary: null,
      actions: ['retry'],
      askOwner: true
    });
    expect(
      recoveryFor({
        kind: 'herbicide',
        lastStatus: 422,
        rejectInfo: { resubmitAs: 'discard' },
        payload: {}
      }).actions
    ).toEqual(['retry']);
  });
});

describe('rewriteForRecovery (D0-11)', () => {
  it('turns a food log into a discard and remembers what it was queued as, once', () => {
    const once = rewriteForRecovery('animal-production', eggs, 'save-as-discard', { now: 5_000 });
    expect(once).toEqual({ ...eggs, use: 'discard', convertedFromUse: 'food' });
    expect(
      rewriteForRecovery('animal-production', once, 'save-as-discard', { now: 5_000 })
    ).toEqual(once);
    expect(rewriteForRecovery('animal-move', eggs, 'save-as-discard', { now: 5_000 })).toBeNull();
  });

  it('drops the live flag and says the animals are already there', () => {
    expect(
      rewriteForRecovery(
        'animal-move',
        { subjectType: 'group', subjectId: 'g1', fieldId: 'f', movedAt: 10, queuedLive: true },
        'already-went',
        { now: 20 }
      )
    ).toEqual({
      subjectType: 'group',
      subjectId: 'g1',
      fieldId: 'f',
      movedAt: 10,
      alreadyThere: true
    });
  });

  it('re-dates each kind on its own date field, never into the future', () => {
    expect(
      rewriteForRecovery('animal-production', eggs, 'record-now', { now: 9_000 })?.occurredAt
    ).toBe(9_000);
    expect(
      rewriteForRecovery('animal-move', { movedAt: 1 }, 'redate', { now: 9_000, at: 20_000 })
        ?.movedAt
    ).toBe(9_000);
    expect(
      rewriteForRecovery('animal-health', { administeredAt: 1, courseEndAt: 2 }, 'redate', {
        now: 9_000,
        at: 5_000
      })
    ).toEqual({ administeredAt: 5_000, courseEndAt: 5_000 });
    expect(rewriteForRecovery('animal-move', { movedAt: 1 }, 'redate', { now: 9_000 })).toBeNull();
    expect(
      rewriteForRecovery('animal-move', { movedAt: 1 }, 'keep-here', { now: 9_000 })
    ).toBeNull();
  });
});

describe('subjects and lineage', () => {
  const snapshot = {
    animals: [
      { id: 'a1', groupId: 'g1' },
      { id: 'a2', groupId: 'g1' },
      { id: 'a3', groupId: null }
    ]
  } as never;

  it('reads the subject, the destination group and named animals of a move', () => {
    expect(
      payloadSubjectKeys('animal-move', {
        subjectType: 'group',
        subjectId: 'g1',
        animalIds: ['a1'],
        fieldId: 'f'
      })
    ).toEqual(['group:g1', 'animal:a1']);
    expect(
      payloadSubjectKeys('animal-move', { subjectType: 'animal', subjectId: 'a3', toGroupId: 'g2' })
    ).toEqual(['animal:a3', 'group:g2']);
    expect(payloadSubjectKeys('herbicide', { subjectType: 'group', subjectId: 'g1' })).toEqual([]);
  });

  it('reads the treatment a queued care-task Done carries', () => {
    const task = {
      taskId: 't1',
      action: 'complete',
      healthEvent: { subjectType: 'group', subjectId: 'g1', kind: 'deworm', productName: 'Wormer' }
    };
    expect(payloadSubjectKeys('task', task)).toEqual(['group:g1']);
    expect(payloadSubjectKeys('task', { taskId: 't1', action: 'complete' })).toEqual([]);
    expect(deleteConfirmText('task', task)).toBe(
      'This record will be lost. The treatment was still given.'
    );
    expect(pendingSummary('task', task)).toBe('Care done with a treatment: Wormer');
  });

  it('reaches a group from its member and the members from the group', () => {
    expect([...lineageKeys(['animal:a1'], snapshot)].sort()).toEqual(['animal:a1', 'group:g1']);
    expect([...lineageKeys(['group:g1'], snapshot)].sort()).toEqual([
      'animal:a1',
      'animal:a2',
      'group:g1'
    ]);
    expect([...lineageKeys(['animal:a3'], null)]).toEqual(['animal:a3']);
  });

  it('says what a deleted record loses', () => {
    expect(deleteConfirmText('animal-production', { kind: 'eggs' })).toBe(
      'This record will be lost. The eggs were still collected.'
    );
    expect(deleteConfirmText('herbicide', {})).toBe('This record will be lost.');
  });
});
