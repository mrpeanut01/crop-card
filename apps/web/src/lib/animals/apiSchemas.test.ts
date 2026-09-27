import { describe, expect, it } from 'vitest';
import {
  animalCreateSchema,
  animalGroupCreateSchema,
  animalGroupPatchSchema,
  animalMoveSchema,
  animalPatchSchema,
  animalStatusSchema
} from './apiSchemas';
import {
  ANIMAL_PURPOSES,
  ANIMAL_SEXES,
  ANIMAL_STATUSES,
  ANIMAL_SUBJECT_TYPES,
  MEAT_STATUSES,
  isHousingAreaKind
} from './model';
import { animalStatusEvents, animals } from '$lib/db/schema';
import * as schema from '$lib/db/schema';

describe('model vocab matches the drizzle enums', () => {
  it('pins subject types, purposes, sexes and statuses', () => {
    expect([...ANIMAL_SUBJECT_TYPES]).toEqual([...schema.ANIMAL_SUBJECT_TYPES]);
    expect([...ANIMAL_PURPOSES]).toEqual([...schema.ANIMAL_PURPOSES]);
    expect([...ANIMAL_SEXES]).toEqual([...animals.sex.enumValues]);
    expect([...ANIMAL_STATUSES]).toEqual([...animals.status.enumValues]);
    for (const s of MEAT_STATUSES) {
      expect(animalStatusEvents.status.enumValues as readonly string[]).toContain(s);
    }
  });

  it('keeps natural areas, water and boundaries out of housing', () => {
    for (const kind of ['natural_area', 'water', 'boundary']) {
      expect(isHousingAreaKind(kind)).toBe(false);
    }
    for (const kind of ['barn', 'pasture', 'coop_pen', 'residence', 'orchard', 'field', 'garden']) {
      expect(isHousingAreaKind(kind)).toBe(true);
    }
  });
});

describe('animalCreateSchema', () => {
  it('needs a name or a tag', () => {
    expect(animalCreateSchema.safeParse({ speciesId: 'dog' }).success).toBe(false);
    expect(animalCreateSchema.safeParse({ speciesId: 'dog', name: '  ' }).success).toBe(false);
    expect(animalCreateSchema.safeParse({ speciesId: 'dog', name: 'Rex' }).success).toBe(true);
    expect(animalCreateSchema.safeParse({ speciesId: 'sheep', tag: '14' }).success).toBe(true);
  });

  it('does not take the food-producing flag or both a group and housing', () => {
    expect(
      animalCreateSchema.safeParse({ speciesId: 'chicken', name: 'Hen', foodProducing: false })
        .success
    ).toBe(false);
    expect(
      animalCreateSchema.safeParse({
        speciesId: 'chicken',
        name: 'Hen',
        groupId: 'g',
        housingFieldId: 'f'
      }).success
    ).toBe(false);
  });
});

describe('animalPatchSchema', () => {
  it('needs a reason for a flag change', () => {
    expect(animalPatchSchema.safeParse({ foodProducing: false }).success).toBe(false);
    expect(
      animalPatchSchema.safeParse({ foodProducing: false, flagReason: 'Retired pet' }).success
    ).toBe(true);
    expect(animalPatchSchema.safeParse({ notForSlaughter: true }).success).toBe(false);
  });

  it('only archives or restores through status', () => {
    expect(animalPatchSchema.safeParse({ status: 'died' }).success).toBe(false);
    expect(animalPatchSchema.safeParse({ status: 'archived' }).success).toBe(true);
  });
});

describe('animalGroupCreateSchema', () => {
  it('names some members out of the head count', () => {
    const ok = animalGroupCreateSchema.safeParse({
      name: 'Layers',
      speciesId: 'chicken',
      headCount: 4,
      members: [{ name: 'Henrietta' }, { name: 'Pearl' }]
    });
    expect(ok.success).toBe(true);
    expect(
      animalGroupCreateSchema.safeParse({
        name: 'Layers',
        speciesId: 'chicken',
        headCount: 1,
        members: [{ name: 'A' }, { name: 'B' }]
      }).success
    ).toBe(false);
    expect(
      animalGroupCreateSchema.safeParse({ name: 'Layers', speciesId: 'chicken', headCount: 0 })
        .success
    ).toBe(false);
  });

  it('patches the flag only with a reason', () => {
    expect(animalGroupPatchSchema.safeParse({ foodProducing: false }).success).toBe(false);
  });
});

describe('animalMoveSchema', () => {
  it('takes either an Area or a group', () => {
    expect(
      animalMoveSchema.safeParse({ subjectType: 'group', subjectId: 'g', fieldId: 'f' }).success
    ).toBe(true);
    expect(animalMoveSchema.safeParse({ subjectType: 'group', subjectId: 'g' }).success).toBe(
      false
    );
    expect(
      animalMoveSchema.safeParse({
        subjectType: 'animal',
        subjectId: 'a',
        fieldId: 'f',
        toGroupId: 'g'
      }).success
    ).toBe(false);
    expect(
      animalMoveSchema.safeParse({ subjectType: 'group', subjectId: 'g', toGroupId: 'h' }).success
    ).toBe(false);
  });

  it('keeps partial-move fields to groups and needs at least one animal', () => {
    expect(
      animalMoveSchema.safeParse({ subjectType: 'animal', subjectId: 'a', fieldId: 'f', count: 2 })
        .success
    ).toBe(false);
    expect(
      animalMoveSchema.safeParse({ subjectType: 'group', subjectId: 'g', fieldId: 'f', count: 0 })
        .success
    ).toBe(false);
    expect(
      animalMoveSchema.safeParse({ subjectType: 'group', subjectId: 'g', fieldId: 'f', count: 5 })
        .success
    ).toBe(true);
  });
});

describe('animalStatusSchema', () => {
  it.each(MEAT_STATUSES)('refuses %s until the 32C withdrawal gate lands', (status) => {
    expect(
      animalStatusSchema.safeParse({ subjectType: 'animal', subjectId: 'a', status }).success
    ).toBe(false);
    expect(
      animalStatusSchema.safeParse({
        subjectType: 'group',
        subjectId: 'g',
        status,
        headCountDelta: -1
      }).success
    ).toBe(false);
  });

  it('needs a negative delta for group losses and a positive one for additions', () => {
    const group = { subjectType: 'group', subjectId: 'g' } as const;
    expect(animalStatusSchema.safeParse({ ...group, status: 'died' }).success).toBe(false);
    expect(
      animalStatusSchema.safeParse({ ...group, status: 'died', headCountDelta: 2 }).success
    ).toBe(false);
    expect(
      animalStatusSchema.safeParse({ ...group, status: 'died', headCountDelta: -2 }).success
    ).toBe(true);
    expect(
      animalStatusSchema.safeParse({ ...group, status: 'active', headCountDelta: 6 }).success
    ).toBe(true);
    expect(
      animalStatusSchema.safeParse({
        subjectType: 'animal',
        subjectId: 'a',
        status: 'died',
        headCountDelta: -1
      }).success
    ).toBe(false);
  });
});
