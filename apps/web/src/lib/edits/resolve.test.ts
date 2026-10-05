import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { editConflicts, type EditConflictBody, type EditValues } from './conflict';
import { keepMineBody, mergeComplete, rebaseEdit, touchedFields, type EditBody } from './resolve';

function conflictFor(
  action: string,
  body: EditBody,
  current: EditValues,
  target: 'planting' | 'task' = 'planting'
): EditConflictBody {
  const mine: EditValues = {};
  for (const f of touchedFields(target, body)) mine[f] = body[f] as never;
  return {
    error: 'Someone else changed this while you were editing. Nothing was saved.',
    code: 'EDIT_CONFLICT',
    target,
    id: 'crop_1',
    action,
    fields: editConflicts(body.base, mine, current),
    current
  };
}

const details: EditBody = {
  action: 'edit-details',
  varietyDisplayName: 'Mine',
  quantityPlanted: 12,
  base: { varietyDisplayName: 'Original', quantityPlanted: 10 }
};
const current: EditValues = {
  varietyDisplayName: 'Theirs',
  quantityPlanted: 10,
  quantityUnit: 'plants',
  harvestUseCases: null,
  plantingDate: 1_000,
  blockId: 'blk_1'
};

describe('rebaseEdit (U-04)', () => {
  it('Keep mine resends every change with base set to what is stored now', () => {
    const c = conflictFor('edit-details', details, current);
    expect(c.fields.map((f) => f.field)).toEqual(['varietyDisplayName']);
    const out = rebaseEdit(details, c, 'mine');
    expect(out).toEqual({
      action: 'edit-details',
      varietyDisplayName: 'Mine',
      quantityPlanted: 12,
      base: { varietyDisplayName: 'Theirs', quantityPlanted: 10 }
    });
    // The rebased edit no longer conflicts with the stored row.
    expect(editConflicts(out!.base, { varietyDisplayName: 'Mine' }, current)).toEqual([]);
  });

  it('Keep theirs sends nothing', () => {
    const c = conflictFor('edit-details', details, current);
    expect(rebaseEdit(details, c, 'theirs')).toBeNull();
  });

  it('Choose for each drops a field kept as now on the farm and keeps the rest', () => {
    const c = conflictFor('edit-details', details, current);
    const out = rebaseEdit(details, c, { merge: { varietyDisplayName: 'theirs' } });
    expect(out).toEqual({
      action: 'edit-details',
      quantityPlanted: 12,
      base: { quantityPlanted: 10 }
    });
  });

  it('a conflicting field with no choice is never sent', () => {
    const c = conflictFor('edit-details', details, current);
    const out = rebaseEdit(details, c, { merge: {} });
    expect(out?.varietyDisplayName).toBeUndefined();
  });

  it('returns null when a merge leaves nothing to change', () => {
    const only: EditBody = {
      action: 'edit-details',
      varietyDisplayName: 'Mine',
      base: { varietyDisplayName: 'Original' }
    };
    const c = conflictFor('edit-details', only, current);
    expect(rebaseEdit(only, c, { merge: { varietyDisplayName: 'theirs' } })).toBeNull();
  });

  it('set-schedule keeps plantingDate as the stored value and drops blockId', () => {
    const sched: EditBody = {
      action: 'set-schedule',
      plantingDate: 5_000,
      blockId: 'blk_2',
      base: { plantingDate: 2_000, blockId: 'blk_0' }
    };
    const c = conflictFor('set-schedule', sched, current);
    expect(c.fields.map((f) => f.field).sort()).toEqual(['blockId', 'plantingDate']);
    const out = rebaseEdit(sched, c, { merge: { plantingDate: 'theirs', blockId: 'mine' } });
    expect(out).toEqual({
      action: 'set-schedule',
      plantingDate: 1_000,
      blockId: 'blk_2',
      base: { plantingDate: 1_000, blockId: 'blk_1' }
    });
    const none = rebaseEdit(sched, c, { merge: { plantingDate: 'theirs', blockId: 'theirs' } });
    expect(none).toBeNull();
  });

  it('works for task edits', () => {
    const edit: EditBody = {
      action: 'edit',
      title: 'Stake tomatoes',
      body: 'Use the tall stakes',
      base: { title: 'Stake', body: null }
    };
    const now: EditValues = {
      title: 'Stake peppers',
      body: null,
      scheduledFor: 1,
      assigneeUserId: null
    };
    const c = conflictFor('edit', edit, now, 'task');
    expect(c.fields.map((f) => f.field)).toEqual(['title']);
    expect(rebaseEdit(edit, c, { merge: { title: 'theirs' } })).toEqual({
      action: 'edit',
      body: 'Use the tall stakes',
      base: { body: null }
    });
  });

  it('mergeComplete needs a choice for every conflicting field', () => {
    const sched: EditBody = {
      action: 'set-schedule',
      plantingDate: 5_000,
      blockId: 'blk_2',
      base: { plantingDate: 2_000, blockId: 'blk_0' }
    };
    const c = conflictFor('set-schedule', sched, current);
    expect(mergeComplete(c, {})).toBe(false);
    expect(mergeComplete(c, { plantingDate: 'mine' })).toBe(false);
    expect(mergeComplete(c, { plantingDate: 'mine', blockId: 'theirs' })).toBe(true);
  });

  it('property: a rebased edit never conflicts and never sends a field kept as theirs', () => {
    const name = fc.constantFrom('A', 'B', 'C');
    const qty = fc.constantFrom(1, 2, 3, null);
    fc.assert(
      fc.property(
        name,
        name,
        name,
        qty,
        qty,
        qty,
        fc.constantFrom('mine', 'theirs'),
        fc.constantFrom('mine', 'theirs'),
        (bName, mName, cName, bQty, mQty, cQty, pickName, pickQty) => {
          const body: EditBody = {
            action: 'edit-details',
            varietyDisplayName: mName,
            quantityPlanted: mQty,
            base: { varietyDisplayName: bName, quantityPlanted: bQty }
          };
          const now: EditValues = { varietyDisplayName: cName, quantityPlanted: cQty };
          const c = conflictFor('edit-details', body, now);
          const merge = { varietyDisplayName: pickName, quantityPlanted: pickQty } as const;
          for (const choice of ['mine', { merge }] as const) {
            const out = rebaseEdit(body, c, choice);
            if (!out) continue;
            const mine: EditValues = {};
            for (const f of touchedFields('planting', out)) mine[f] = out[f] as never;
            expect(editConflicts(out.base, mine, now)).toEqual([]);
            if (choice !== 'mine') {
              for (const f of c.fields) {
                if (merge[f.field as 'varietyDisplayName'] === 'theirs') {
                  expect(Object.hasOwn(out, f.field)).toBe(false);
                }
              }
            }
          }
        }
      )
    );
  });
});

describe('keepMineBody', () => {
  it('moves every base entry to the stored value and keeps the change', () => {
    const conflict = {
      error: 'x',
      code: 'EDIT_CONFLICT' as const,
      target: 'stock' as const,
      id: 's1',
      action: 'set-quantity',
      fields: [{ field: 'onHand' as const, base: 10, mine: 7, theirs: 4 }],
      current: { onHand: 4 }
    };
    expect(keepMineBody({ quantity: 7, base: { onHand: 10 } }, conflict)).toEqual({
      quantity: 7,
      base: { onHand: 4 }
    });
  });
});
