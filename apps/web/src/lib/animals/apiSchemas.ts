import { z } from 'zod';
import { MAX_PHOTO_DATA_URL_CHARS } from '$lib/journal/photo';
import {
  ANIMAL_PURPOSES,
  ANIMAL_SEXES,
  ANIMAL_SUBJECT_TYPES,
  MAX_ANIMAL_NAME,
  MAX_ANIMAL_TAG,
  MAX_HEAD_COUNT,
  MAX_NOTES,
  MAX_REASON,
  STATUS_EVENT_STATUSES
} from './model';

/** Request bodies of the animal and group endpoints. Kept free of server
 *  imports so the OpenAPI generator can publish them. */

const id = z.string().min(1).max(128);
const ms = z.number().int().positive();
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullable().optional();
const reason = z.string().trim().min(1).max(MAX_REASON);
const photo = z
  .string()
  .max(MAX_PHOTO_DATA_URL_CHARS + 8)
  .nullable();

function hasIdentifier(v: { name?: string | null; tag?: string | null }): boolean {
  return !!v.name?.trim() || !!v.tag?.trim();
}

const IDENTIFIER_MESSAGE = 'give a name or a tag, or add them as a group with a count';

const identity = {
  name: optionalText(MAX_ANIMAL_NAME),
  tag: optionalText(MAX_ANIMAL_TAG),
  sex: z.enum(ANIMAL_SEXES).optional(),
  breed: optionalText(80)
};

/** `POST /api/animals`. One of name or tag is required. The food-producing
 *  flag comes from the species and is not set here. */
export const animalCreateSchema = z
  .strictObject({
    speciesId: id,
    ...identity,
    birthDate: ms.nullable().optional(),
    birthDateEstimated: z.boolean().optional(),
    acquiredDate: ms.nullable().optional(),
    acquiredFrom: optionalText(200),
    purpose: z.enum(ANIMAL_PURPOSES).optional(),
    groupId: id.nullable().optional(),
    housingFieldId: id.nullable().optional(),
    notes: optionalText(MAX_NOTES)
  })
  .refine(hasIdentifier, { message: IDENTIFIER_MESSAGE, path: ['name'] })
  .refine((v) => !(v.groupId && v.housingFieldId), {
    message: 'an animal in a group lives where its group lives',
    path: ['housingFieldId']
  });

/** `PATCH /api/animals/:id`. Null clears a value. Changing `foodProducing`
 *  or `notForSlaughter` needs `flagReason` and the owner role. Housing and
 *  group changes go through `POST /api/animals/move`, outcomes through
 *  `POST /api/animals/status`. */
export const animalPatchSchema = z
  .strictObject({
    ...identity,
    birthDate: ms.nullable().optional(),
    birthDateEstimated: z.boolean().optional(),
    acquiredDate: ms.nullable().optional(),
    acquiredFrom: optionalText(200),
    purpose: z.enum(ANIMAL_PURPOSES).optional(),
    notes: optionalText(MAX_NOTES),
    photo: photo.optional(),
    foodProducing: z.boolean().optional(),
    notForSlaughter: z.boolean().optional(),
    flagReason: reason.optional(),
    status: z.enum(['active', 'archived']).optional()
  })
  .refine(
    (v) => (v.foodProducing === undefined && v.notForSlaughter === undefined) || !!v.flagReason,
    { message: 'say why the flag is changing', path: ['flagReason'] }
  );

const memberSchema = z
  .strictObject({
    name: optionalText(MAX_ANIMAL_NAME),
    tag: optionalText(MAX_ANIMAL_TAG),
    sex: z.enum(ANIMAL_SEXES).optional()
  })
  .refine(hasIdentifier, { message: 'each named animal needs a name or a tag', path: ['name'] });

/** `POST /api/animal-groups`. `headCount` is the whole group; each entry in
 *  `members` becomes a named animal in the group and is taken off the
 *  unnamed count. */
export const animalGroupCreateSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(MAX_ANIMAL_NAME),
    speciesId: id,
    purpose: z.enum(ANIMAL_PURPOSES).optional(),
    headCount: z.number().int().min(0).max(MAX_HEAD_COUNT),
    members: z.array(memberSchema).max(200).optional(),
    housingFieldId: id.nullable().optional(),
    notes: optionalText(MAX_NOTES)
  })
  .refine((v) => (v.members?.length ?? 0) <= v.headCount, {
    message: 'more named animals than the head count',
    path: ['members']
  })
  .refine((v) => v.headCount > 0, {
    message: 'a group needs at least one animal',
    path: ['headCount']
  });

/** `PATCH /api/animal-groups/:id`. A `headCount` change writes a status
 *  event with the difference so the count keeps an audit trail. */
export const animalGroupPatchSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(MAX_ANIMAL_NAME).optional(),
    purpose: z.enum(ANIMAL_PURPOSES).optional(),
    notes: optionalText(MAX_NOTES),
    headCount: z.number().int().min(0).max(MAX_HEAD_COUNT).optional(),
    countReason: optionalText(MAX_REASON),
    foodProducing: z.boolean().optional(),
    flagReason: reason.optional(),
    status: z.enum(['active', 'archived']).optional()
  })
  .refine((v) => v.foodProducing === undefined || !!v.flagReason, {
    message: 'say why the flag is changing',
    path: ['flagReason']
  });

/** `POST /api/animals/move`. Safe to replay from the offline queue with the
 *  client record id header.
 *  - A group or an individual to an Area: `fieldId`.
 *  - Part of a group: `count` unnamed animals and/or the named `animalIds`
 *    split off into a new group at `fieldId`.
 *  - An individual into a group: `toGroupId` (it then lives where the group
 *    lives). An individual moved to an Area leaves its group. */
export const animalMoveSchema = z
  .strictObject({
    subjectType: z.enum(ANIMAL_SUBJECT_TYPES),
    subjectId: id,
    fieldId: id.optional(),
    toGroupId: id.optional(),
    count: z.number().int().min(0).max(MAX_HEAD_COUNT).optional(),
    animalIds: z.array(id).max(500).optional(),
    newGroupName: z.string().trim().min(1).max(MAX_ANIMAL_NAME).optional(),
    movedAt: ms.optional()
  })
  .refine((v) => !!v.fieldId !== !!v.toGroupId, {
    message: 'give either fieldId or toGroupId',
    path: ['fieldId']
  })
  .refine((v) => !v.toGroupId || v.subjectType === 'animal', {
    message: 'only an individual can join a group',
    path: ['toGroupId']
  })
  .refine(
    (v) =>
      v.subjectType === 'group' ||
      (v.count === undefined && v.animalIds === undefined && v.newGroupName === undefined),
    { message: 'count, animalIds and newGroupName apply to a group', path: ['count'] }
  )
  .refine(
    (v) =>
      v.count === undefined && v.animalIds === undefined
        ? true
        : (v.count ?? 0) + (v.animalIds?.length ?? 0) > 0,
    { message: 'move at least one animal', path: ['count'] }
  );

/** `POST /api/animals/status`. `sold-for-meat` and `slaughtered` are
 *  refused until the withdrawal gate lands (32C). On a group, outcomes need
 *  a negative `headCountDelta` for the unnamed animals that left; `active`
 *  with a positive delta records a hatch or purchase. */
export const animalStatusSchema = z
  .strictObject({
    subjectType: z.enum(ANIMAL_SUBJECT_TYPES),
    subjectId: id,
    status: z.enum(STATUS_EVENT_STATUSES),
    occurredAt: ms.optional(),
    reason: optionalText(MAX_REASON),
    headCountDelta: z.number().int().min(-MAX_HEAD_COUNT).max(MAX_HEAD_COUNT).optional()
  })
  .refine((v) => v.subjectType === 'group' || v.headCountDelta === undefined, {
    message: 'headCountDelta applies to a group',
    path: ['headCountDelta']
  })
  .refine(
    (v) =>
      v.subjectType === 'animal' ||
      (v.status === 'active'
        ? (v.headCountDelta ?? 0) > 0
        : v.headCountDelta !== undefined && v.headCountDelta < 0),
    {
      message:
        'a group needs a negative headCountDelta for losses and a positive one for additions',
      path: ['headCountDelta']
    }
  );

export type AnimalCreateInput = z.infer<typeof animalCreateSchema>;
export type AnimalPatchInput = z.infer<typeof animalPatchSchema>;
export type AnimalGroupCreateInput = z.infer<typeof animalGroupCreateSchema>;
export type AnimalGroupPatchInput = z.infer<typeof animalGroupPatchSchema>;
export type AnimalMoveInput = z.infer<typeof animalMoveSchema>;
export type AnimalStatusInput = z.infer<typeof animalStatusSchema>;
