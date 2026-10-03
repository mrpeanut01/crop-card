import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  EDIT_CONFLICT_CODE,
  EDIT_FIELDS_BY_ACTION,
  editConflicts,
  isEditConflictBody,
  sameEditValue,
  type EditValue
} from './conflict';
import { cropEditDetailsBaseSchema, cropScheduleBaseSchema } from '$lib/crops/apiSchemas';
import {
  taskAssignBaseSchema,
  taskEditBaseSchema,
  taskRescheduleBaseSchema
} from '$lib/tasks/apiSchemas';

describe('sameEditValue', () => {
  it('treats null and undefined as equal', () => {
    expect(sameEditValue(null, undefined)).toBe(true);
    expect(sameEditValue(undefined, undefined)).toBe(true);
    expect(sameEditValue(null, '')).toBe(false);
    expect(sameEditValue(0, null)).toBe(false);
  });
  it('compares numbers and strings exactly', () => {
    expect(sameEditValue(1, 1)).toBe(true);
    expect(sameEditValue(1, '1')).toBe(false);
    expect(sameEditValue('Lettuce', 'lettuce')).toBe(false);
    expect(sameEditValue('Lettuce ', 'Lettuce')).toBe(false);
  });
  it('compares lists as sorted sets', () => {
    expect(sameEditValue(['b', 'a'], ['a', 'b'])).toBe(true);
    expect(sameEditValue(['a', 'a'], ['a'])).toBe(true);
    expect(sameEditValue(['a'], ['a', 'b'])).toBe(false);
    expect(sameEditValue([], null)).toBe(false);
    expect(sameEditValue(['a'], 'a')).toBe(false);
  });
  it('is symmetric', () => {
    const value = fc.oneof(
      fc.constant(null),
      fc.integer(),
      fc.string({ maxLength: 4 }),
      fc.array(fc.string({ maxLength: 2 }), { maxLength: 3 })
    ) as fc.Arbitrary<EditValue>;
    fc.assert(fc.property(value, value, (a, b) => sameEditValue(a, b) === sameEditValue(b, a)));
  });
});

describe('editConflicts', () => {
  it('passes when the stored value still equals base', () => {
    expect(editConflicts({ title: 'A' }, { title: 'B' }, { title: 'A' })).toEqual([]);
  });
  it('passes when the stored value already equals the requested value', () => {
    expect(editConflicts({ title: 'A' }, { title: 'B' }, { title: 'B' })).toEqual([]);
  });
  it('reports a field that moved to a third value', () => {
    expect(editConflicts({ title: 'A' }, { title: 'B' }, { title: 'C' })).toEqual([
      { field: 'title', base: 'A', mine: 'B', theirs: 'C' }
    ]);
  });
  it('does not check a field changed without a base entry', () => {
    expect(editConflicts({}, { title: 'B' }, { title: 'C' })).toEqual([]);
  });
  it('does not check a base entry the edit does not change', () => {
    expect(
      editConflicts({ title: 'A', body: 'x' }, { title: 'B' }, { title: 'A', body: 'y' })
    ).toEqual([]);
  });
  it('checks a base of null as a real value', () => {
    expect(editConflicts({ body: null }, { body: 'n' }, { body: 'other' })).toEqual([
      { field: 'body', base: null, mine: 'n', theirs: 'other' }
    ]);
    expect(editConflicts({ body: null }, { body: 'n' }, {})).toEqual([]);
  });
  it('compares harvest windows as a set', () => {
    expect(
      editConflicts(
        { harvestUseCases: ['a', 'b'] },
        { harvestUseCases: ['c'] },
        { harvestUseCases: ['b', 'a'] }
      )
    ).toEqual([]);
  });
});

describe('isEditConflictBody', () => {
  const body = {
    error: 'x',
    code: EDIT_CONFLICT_CODE,
    target: 'planting',
    id: 'c1',
    action: 'edit-details',
    fields: [{ field: 'varietyDisplayName', base: 'A', mine: 'B', theirs: 'C' }],
    current: { varietyDisplayName: 'C', harvestUseCases: null, quantityPlanted: 3 }
  };
  it('accepts a well-formed body', () => {
    expect(isEditConflictBody(body)).toBe(true);
  });
  it('refuses other shapes', () => {
    expect(isEditConflictBody(null)).toBe(false);
    expect(isEditConflictBody({ ...body, code: 'TASK_CLOSED' })).toBe(false);
    expect(isEditConflictBody({ ...body, target: 'animal' })).toBe(false);
    expect(
      isEditConflictBody({ ...body, fields: [{ field: 'nope', base: 1, mine: 1, theirs: 1 }] })
    ).toBe(false);
    expect(isEditConflictBody({ ...body, current: { varietyDisplayName: {} } })).toBe(false);
    expect(isEditConflictBody({ ...body, current: [] })).toBe(false);
  });
});

describe('base schemas match EDIT_FIELDS_BY_ACTION', () => {
  const schemas = {
    'planting:edit-details': cropEditDetailsBaseSchema,
    'planting:set-schedule': cropScheduleBaseSchema,
    'task:edit': taskEditBaseSchema,
    'task:reschedule': taskRescheduleBaseSchema,
    'task:assign': taskAssignBaseSchema
  };
  it('has one base schema per checked action, with exactly its fields', () => {
    expect(Object.keys(schemas).sort()).toEqual(Object.keys(EDIT_FIELDS_BY_ACTION).sort());
    for (const [key, schema] of Object.entries(schemas)) {
      expect(Object.keys(schema.shape).sort()).toEqual([...EDIT_FIELDS_BY_ACTION[key]].sort());
    }
  });
  it('is strict and nullable', () => {
    expect(taskEditBaseSchema.safeParse({ title: null, body: null }).success).toBe(true);
    expect(taskEditBaseSchema.safeParse({ scheduledFor: 1 }).success).toBe(false);
  });
});
