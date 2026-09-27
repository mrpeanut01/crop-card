/**
 * Animal and group rules shared by the `/api/animals/**` and
 * `/api/animal-groups/**` endpoints: creation with housing, moves (whole
 * group, part of a group, an individual into or out of a group), status
 * changes and their owner-only undo. Reads resolve a plan first and writes
 * apply it, so the 32C grazing gate can run between the two.
 */

import { json } from '@sveltejs/kit';
import type { z } from 'zod';
import { db } from '$lib/db/client';
import {
  findTagConflicts,
  getAnimal,
  insertAnimal,
  listAnimals,
  setAnimalGroupAndHousing,
  setAnimalStatus,
  wasEverFoodProducing,
  type Animal
} from '$lib/db/animals';
import {
  activeMemberCount,
  getAnimalGroup,
  getAnimalGroupSummary,
  insertAnimalGroup,
  setGroupHeadCount,
  type AnimalGroup
} from '$lib/db/animalGroups';
import {
  endStayAt,
  housedOnField,
  insertGroupChangeMarker,
  insertStay,
  listLocationsForSubject,
  refreshHousingCache,
  reopenStayEndingAt,
  type AnimalLocation,
  type Subject
} from '$lib/db/animalLocations';
import {
  deleteStatusEvent,
  evaluateStatusLock,
  getStatusEvent,
  insertStatusEvent,
  listStatusEvents,
  type AnimalStatusEvent
} from '$lib/db/animalStatus';
import { getField, type Field } from '$lib/db/fields';
import { getDataKinds } from '$lib/server/registry';
import type {
  AnimalCreateInput,
  AnimalGroupCreateInput,
  AnimalMoveInput,
  AnimalStatusInput
} from '$lib/animals/apiSchemas';
import { capacityState, type CapacityState } from '$lib/animals/counts';
import {
  MAX_FUTURE_SKEW_MS,
  animalStatusAfter,
  isHousingAreaKind,
  isOutcomeStatus,
  type AnimalPurpose
} from '$lib/animals/model';
import { isMarker, openStay } from '$lib/animals/timeline';

export interface SpeciesInfo {
  pluginId: string;
  name: string;
  foodProducingDefault: boolean;
  notForSlaughterToggle: boolean;
  products: readonly string[];
}

export async function getSpecies(speciesId: string): Promise<SpeciesInfo | undefined> {
  const plugin = (await getDataKinds()).species.get(speciesId);
  if (!plugin) return undefined;
  return {
    pluginId: plugin.pluginId,
    name: plugin.displayName,
    foodProducingDefault: plugin.foodProducingDefault,
    notForSlaughterToggle: plugin.notForSlaughterToggle === true,
    products: plugin.products ?? []
  };
}

/** A refusal with a stable code the UI can branch on. */
export class AnimalRuleError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    /** More of the answer body (the hold guard's diff, say). */
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'AnimalRuleError';
  }

  toResponse(): Response {
    return json({ ...this.extra, error: this.message, code: this.code }, { status: this.status });
  }
}

export function ruleResponse(e: unknown): Response {
  if (e instanceof AnimalRuleError) return e.toResponse();
  throw e;
}

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S
): Promise<Parsed<z.infer<S>>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: json({ error: 'invalid JSON body' }, { status: 400 }) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: json(
        {
          error: parsed.error.issues[0]?.message ?? 'invalid request',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
        },
        { status: 400 }
      )
    };
  }
  return { ok: true, data: parsed.data };
}

export interface Warning {
  code: 'TAG_IN_USE';
  message: string;
  animalId: string;
}

function label(a: Pick<Animal, 'name' | 'tag'>): string {
  return a.name ?? (a.tag ? `tag ${a.tag}` : 'another animal');
}

export function tagWarnings(tag: string | null | undefined, excludeId?: string): Warning[] {
  if (!tag?.trim()) return [];
  return findTagConflicts(tag, excludeId).map((a) => ({
    code: 'TAG_IN_USE' as const,
    message: `Tag ${tag.trim()} is already used by ${label(a)}.`,
    animalId: a.id
  }));
}

/** An Area animals can live on. The caller has already checked it belongs
 *  to this Owner. */
export function housingArea(fieldId: string): Field {
  const field = getField(fieldId);
  if (!field) throw new AnimalRuleError('UNKNOWN_AREA', 400, 'That Area is not on this farm.');
  if (!isHousingAreaKind(field.kind)) {
    throw new AnimalRuleError(
      'NOT_A_HOUSING_AREA',
      400,
      'Animals cannot be housed on a natural area, water or a boundary.'
    );
  }
  return field;
}

/** Owner-typed capacity on a coop or pen, shown but never enforced. */
export function areaCapacity(field: Field): CapacityState | null {
  if (field.kind !== 'coop_pen') return null;
  const details = field.details as { capacity?: unknown } | null;
  return capacityState(details?.capacity, housedOnField(field.id).total);
}

function defaultPurpose(species: SpeciesInfo): AnimalPurpose {
  return species.foodProducingDefault ? 'production' : 'pet';
}

function activeGroup(groupId: string, speciesId: string): AnimalGroup {
  const group = getAnimalGroup(groupId);
  if (!group) throw new AnimalRuleError('UNKNOWN_GROUP', 400, 'That group is not on this farm.');
  if (group.status !== 'active') {
    throw new AnimalRuleError('GROUP_ARCHIVED', 409, 'That group is archived.');
  }
  if (group.speciesId !== speciesId) {
    throw new AnimalRuleError(
      'SPECIES_MISMATCH',
      409,
      'A group holds one species. House the two groups on the same Area instead.'
    );
  }
  return group;
}

/** What the placement gate that let a create through stores with its stay,
 *  as `applyMove` stores it with a move (C-18). */
export interface PlacementGated {
  rulesVersion?: string | null;
  exposureFloor?: string | null;
}

export function createAnimalWithHousing(
  input: AnimalCreateInput,
  species: SpeciesInfo,
  userId: string | null,
  now = Date.now(),
  gated: PlacementGated = {}
): { animal: Animal; warnings: Warning[] } {
  const group = input.groupId ? activeGroup(input.groupId, species.pluginId) : null;
  const field = input.housingFieldId ? housingArea(input.housingFieldId) : null;
  const warnings = tagWarnings(input.tag);
  const animal = db.transaction(() => {
    const created = insertAnimal(
      {
        speciesId: species.pluginId,
        groupId: group?.id ?? null,
        name: input.name,
        tag: input.tag,
        sex: input.sex,
        breed: input.breed,
        birthDate: input.birthDate,
        birthDateEstimated: input.birthDateEstimated,
        acquiredDate: input.acquiredDate,
        acquiredFrom: input.acquiredFrom,
        purpose: input.purpose ?? group?.purpose ?? defaultPurpose(species),
        foodProducing: species.foodProducingDefault,
        housingFieldId: group ? group.housingFieldId : (field?.id ?? null),
        notes: input.notes
      },
      now
    );
    if (field) {
      insertStay({
        subject: { subjectType: 'animal', subjectId: created.id },
        fieldId: field.id,
        atMs: now,
        movedBy: userId,
        rulesVersion: gated.rulesVersion ?? null,
        exposureFloor: gated.exposureFloor ?? null
      });
    }
    return created;
  });
  return { animal, warnings };
}

export function createGroupWithMembers(
  input: AnimalGroupCreateInput,
  species: SpeciesInfo,
  userId: string | null,
  now = Date.now(),
  gated: PlacementGated = {}
): { group: AnimalGroup; members: Animal[]; warnings: Warning[] } {
  const field = input.housingFieldId ? housingArea(input.housingFieldId) : null;
  const members = input.members ?? [];
  const purpose = input.purpose ?? defaultPurpose(species);
  const warnings = members.flatMap((m) => tagWarnings(m.tag));
  return db.transaction(() => {
    const group = insertAnimalGroup(
      {
        name: input.name,
        speciesId: species.pluginId,
        purpose,
        headCount: input.headCount - members.length,
        foodProducing: species.foodProducingDefault,
        housingFieldId: field?.id ?? null,
        notes: input.notes
      },
      now
    );
    if (field) {
      insertStay({
        subject: { subjectType: 'group', subjectId: group.id },
        fieldId: field.id,
        atMs: now,
        movedBy: userId,
        rulesVersion: gated.rulesVersion ?? null,
        exposureFloor: gated.exposureFloor ?? null
      });
    }
    const created = members.map((m) =>
      insertAnimal(
        {
          speciesId: species.pluginId,
          groupId: group.id,
          name: m.name,
          tag: m.tag,
          sex: m.sex,
          purpose,
          foodProducing: species.foodProducingDefault,
          housingFieldId: field?.id ?? null
        },
        now
      )
    );
    return { group, members: created, warnings };
  });
}

// ─── Moves ──────────────────────────────────────────────────────────────

export type MovePlan =
  | {
      kind: 'group';
      group: AnimalGroup;
      field: Field;
      movedAt: number;
      arriving: number;
    }
  | {
      kind: 'group-split';
      group: AnimalGroup;
      field: Field;
      movedAt: number;
      count: number;
      members: Animal[];
      newGroupName: string;
      arriving: number;
    }
  | { kind: 'animal-to-area'; animal: Animal; field: Field; movedAt: number; arriving: 1 }
  | {
      kind: 'animal-to-group';
      animal: Animal;
      target: AnimalGroup;
      field: Field | null;
      movedAt: number;
      arriving: 1;
    };

function lastOwnMoment(stays: AnimalLocation[]): number {
  return stays.reduce((m, s) => Math.max(m, s.fromMs, s.toMs ?? s.fromMs), 0);
}

function startsAt(stays: AnimalLocation[], at: number): boolean {
  return stays.some((s) => !isMarker(s) && s.fromMs === at);
}

function sameTime(): never {
  throw new AnimalRuleError(
    'SAME_TIME',
    409,
    'Another move is already recorded at that exact time. Change the time a little.'
  );
}

/** Reads and checks everything a move needs, writing nothing. Throws an
 *  `AnimalRuleError` for a move that cannot happen. */
export function planMove(input: AnimalMoveInput, now = Date.now()): MovePlan {
  const movedAt = input.movedAt ?? now;
  if (movedAt > now + MAX_FUTURE_SKEW_MS) {
    throw new AnimalRuleError('IN_THE_FUTURE', 400, 'A move cannot be dated in the future.');
  }
  const field = input.fieldId ? housingArea(input.fieldId) : null;

  if (input.subjectType === 'group') {
    const group = getAnimalGroup(input.subjectId);
    if (!group) throw new AnimalRuleError('UNKNOWN_SUBJECT', 400, unknownSubjectMessage);
    if (group.status !== 'active') {
      throw new AnimalRuleError('NOT_ACTIVE', 409, 'This group is archived. Restore it first.');
    }
    const summary = getAnimalGroupSummary(group.id)!;
    const stays = listLocationsForSubject('group', group.id);
    const partial = input.count !== undefined || input.animalIds !== undefined;
    if (partial) {
      const count = input.count ?? 0;
      if (count > group.headCount) {
        throw new AnimalRuleError(
          'COUNT_TOO_HIGH',
          409,
          `Only ${group.headCount} unnamed animals are in this group.`
        );
      }
      const wanted = new Set(input.animalIds ?? []);
      const members = listAnimals({ status: 'active', groupId: group.id }).filter((a) =>
        wanted.has(a.id)
      );
      if (members.length !== wanted.size) {
        throw new AnimalRuleError(
          'NOT_A_MEMBER',
          400,
          'Some of the picked animals are not active members of this group.'
        );
      }
      const moving = count + members.length;
      if (moving < summary.total) {
        return {
          kind: 'group-split',
          group,
          field: field!,
          movedAt,
          count,
          members,
          newGroupName: input.newGroupName ?? `${group.name} (${moving})`,
          arriving: moving
        };
      }
    }
    if (group.housingFieldId === field!.id && (stays.at(-1)?.fromMs ?? 0) <= movedAt) {
      throw new AnimalRuleError('ALREADY_THERE', 409, 'They are already there.');
    }
    if (startsAt(stays, movedAt)) sameTime();
    return { kind: 'group', group, field: field!, movedAt, arriving: summary.total };
  }

  const animal = getAnimal(input.subjectId);
  if (!animal) throw new AnimalRuleError('UNKNOWN_SUBJECT', 400, unknownSubjectMessage);
  if (animal.status !== 'active') {
    throw new AnimalRuleError(
      'NOT_ACTIVE',
      409,
      animal.status === 'archived'
        ? 'This animal is archived. Restore it first.'
        : 'This animal is no longer here.'
    );
  }
  const stays = listLocationsForSubject('animal', animal.id);

  if (input.toGroupId) {
    const target = activeGroup(input.toGroupId, animal.speciesId);
    if (animal.groupId === target.id) {
      throw new AnimalRuleError('ALREADY_THERE', 409, 'This animal is already in that group.');
    }
    if (stays.some((s) => s.fromMs > movedAt)) {
      throw new AnimalRuleError(
        'OUT_OF_ORDER',
        409,
        'This animal has a later move on record. Record the group change after it.'
      );
    }
    const targetField = target.housingFieldId ? (getField(target.housingFieldId) ?? null) : null;
    if (!targetField && !animal.housingFieldId) {
      throw new AnimalRuleError(
        'NO_AREA',
        409,
        'Neither this animal nor that group has a place to live yet. Set where the group lives first, so the change is on record.'
      );
    }
    return { kind: 'animal-to-group', animal, target, field: targetField, movedAt, arriving: 1 };
  }

  if (animal.groupId) {
    if (movedAt < lastOwnMoment(stays)) {
      throw new AnimalRuleError(
        'OUT_OF_ORDER',
        409,
        'This animal has a later move on record. Record this move after it.'
      );
    }
  } else {
    if (animal.housingFieldId === field!.id && (stays.at(-1)?.fromMs ?? 0) <= movedAt) {
      throw new AnimalRuleError('ALREADY_THERE', 409, 'This animal is already there.');
    }
    if (startsAt(stays, movedAt)) sameTime();
  }
  return { kind: 'animal-to-area', animal, field: field!, movedAt, arriving: 1 };
}

export const unknownSubjectMessage =
  'This animal or group is not on this farm. It may have been deleted, or it was added on another device and has not synced.';

export interface MoveResult {
  subjectType: 'animal' | 'group';
  subjectId: string;
  fieldId: string | null;
  location: AnimalLocation | null;
  /** The group split off by a partial move. */
  newGroup: AnimalGroup | null;
  capacity: CapacityState | null;
}

export interface MoveContext {
  movedBy: string | null;
  clientRecordId?: string | null;
  /** Set when the grazing gate ran on this move (C-18 for grazing). */
  rulesVersion?: string | null;
  /** The gate's dated exposure holds, stored on the new stay as a floor. */
  exposureFloor?: string | null;
}

function staySaved(result: ReturnType<typeof insertStay>): AnimalLocation {
  if (!result.ok) sameTime();
  return result.location;
}

/** Writes a planned move. Run inside `writeRecord` so the stay, the housing
 *  cache and the replay receipt commit together. */
export function applyMove(plan: MovePlan, ctx: MoveContext, now = Date.now()): MoveResult {
  const base = { movedBy: ctx.movedBy, clientRecordId: ctx.clientRecordId ?? null };
  const gated = {
    rulesVersion: ctx.rulesVersion ?? null,
    exposureFloor: ctx.exposureFloor ?? null
  };
  switch (plan.kind) {
    case 'group': {
      const subject: Subject = { subjectType: 'group', subjectId: plan.group.id };
      const location = staySaved(
        insertStay({ ...base, ...gated, subject, fieldId: plan.field.id, atMs: plan.movedAt })
      );
      const fieldId = refreshHousingCache(subject, now);
      return {
        subjectType: 'group',
        subjectId: plan.group.id,
        fieldId,
        location,
        newGroup: null,
        capacity: areaCapacity(plan.field)
      };
    }
    case 'group-split': {
      const { group, field } = plan;
      const newGroup = insertAnimalGroup(
        {
          name: plan.newGroupName,
          speciesId: group.speciesId,
          purpose: group.purpose,
          headCount: plan.count,
          foodProducing: subjectFoodProducing('group', group.id),
          housingFieldId: field.id
        },
        now
      );
      setGroupHeadCount(group.id, group.headCount - plan.count, now);
      const subject: Subject = { subjectType: 'group', subjectId: newGroup.id };
      const location = staySaved(
        insertStay({
          ...base,
          ...gated,
          subject,
          fieldId: field.id,
          atMs: plan.movedAt,
          fromGroupId: group.id
        })
      );
      for (const member of plan.members) {
        setAnimalGroupAndHousing(member.id, newGroup.id, field.id, now);
        insertGroupChangeMarker({
          subject: { subjectType: 'animal', subjectId: member.id },
          fieldId: field.id,
          atMs: plan.movedAt,
          movedBy: ctx.movedBy,
          fromGroupId: group.id,
          toGroupId: newGroup.id
        });
      }
      refreshHousingCache(subject, now);
      return {
        subjectType: 'group',
        subjectId: group.id,
        fieldId: field.id,
        location,
        newGroup: getAnimalGroup(newGroup.id) ?? newGroup,
        capacity: areaCapacity(field)
      };
    }
    case 'animal-to-area': {
      const { animal, field } = plan;
      const subject: Subject = { subjectType: 'animal', subjectId: animal.id };
      if (animal.groupId) setAnimalGroupAndHousing(animal.id, null, null, now);
      const location = staySaved(
        insertStay({
          ...base,
          ...gated,
          subject,
          fieldId: field.id,
          atMs: plan.movedAt,
          fromGroupId: animal.groupId
        })
      );
      const fieldId = refreshHousingCache(subject, now);
      return {
        subjectType: 'animal',
        subjectId: animal.id,
        fieldId,
        location,
        newGroup: null,
        capacity: areaCapacity(field)
      };
    }
    case 'animal-to-group': {
      const { animal, target, field } = plan;
      const subject: Subject = { subjectType: 'animal', subjectId: animal.id };
      let location: AnimalLocation | null = null;
      if (!animal.groupId) location = endStayAt(subject, plan.movedAt, target.id);
      const markerFieldId = field?.id ?? animal.housingFieldId;
      if (!location && markerFieldId) {
        location = insertGroupChangeMarker({
          ...base,
          subject,
          fieldId: markerFieldId,
          atMs: plan.movedAt,
          fromGroupId: animal.groupId,
          toGroupId: target.id
        });
      }
      setAnimalGroupAndHousing(animal.id, target.id, target.housingFieldId, now);
      const fieldId = refreshHousingCache(subject, now);
      return {
        subjectType: 'animal',
        subjectId: animal.id,
        fieldId,
        location,
        newGroup: null,
        capacity: field ? areaCapacity(field) : null
      };
    }
  }
}

// ─── Status changes ─────────────────────────────────────────────────────

export interface StatusResult {
  event: AnimalStatusEvent;
  /** A group with nobody left: the UI offers to archive it. */
  emptied: boolean;
}

export function recordStatus(
  input: AnimalStatusInput,
  ctx: {
    recordedBy: string | null;
    clientRecordId?: string | null;
    /** The rules version when the food gate ran on this change. */
    rulesVersion?: string | null;
  },
  now = Date.now()
): StatusResult {
  const occurredAt = input.occurredAt ?? now;
  if (occurredAt > now + MAX_FUTURE_SKEW_MS) {
    throw new AnimalRuleError('IN_THE_FUTURE', 400, 'A status change cannot be in the future.');
  }
  const common = {
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    status: input.status,
    occurredAt,
    reason: input.reason,
    recordedById: ctx.recordedBy,
    clientRecordId: ctx.clientRecordId ?? null,
    rulesVersion: ctx.rulesVersion ?? null,
    createdAt: now
  };

  if (input.subjectType === 'group') {
    const group = getAnimalGroup(input.subjectId);
    if (!group) throw new AnimalRuleError('UNKNOWN_SUBJECT', 400, unknownSubjectMessage);
    if (group.status !== 'active') {
      throw new AnimalRuleError('NOT_ACTIVE', 409, 'This group is archived. Restore it first.');
    }
    const delta = input.headCountDelta ?? 0;
    const next = group.headCount + delta;
    if (next < 0) {
      throw new AnimalRuleError(
        'COUNT_TOO_HIGH',
        409,
        `Only ${group.headCount} unnamed animals are in this group. Record a named animal on its own page.`
      );
    }
    const event = insertStatusEvent({ ...common, headCountDelta: delta });
    setGroupHeadCount(group.id, next, now);
    return { event, emptied: next === 0 && activeMemberCount(group.id) === 0 };
  }

  const animal = getAnimal(input.subjectId);
  if (!animal) throw new AnimalRuleError('UNKNOWN_SUBJECT', 400, unknownSubjectMessage);
  const subject: Subject = { subjectType: 'animal', subjectId: animal.id };
  if (input.status === 'active') {
    if (!isOutcomeStatus(animal.status)) {
      throw new AnimalRuleError('ALREADY_ACTIVE', 409, 'This animal is already here.');
    }
    const outcome = listStatusEvents('animal', animal.id)
      .filter((e) => isOutcomeStatus(e.status))
      .at(-1);
    const event = insertStatusEvent(common);
    setAnimalStatus(animal.id, 'active', occurredAt, event.reason, now);
    if (outcome && !animal.groupId) reopenStayEndingAt(subject, outcome.occurredAt);
    refreshHousingCache(subject, now);
    return { event, emptied: false };
  }
  if (animal.status !== 'active') {
    throw new AnimalRuleError(
      'NOT_ACTIVE',
      409,
      animal.status === 'archived'
        ? 'This animal is archived. Restore it first.'
        : 'This animal is already recorded as no longer here.'
    );
  }
  const stays = listLocationsForSubject('animal', animal.id);
  const open = openStay(stays);
  if (occurredAt < lastOwnMoment(stays) || (open && occurredAt <= open.fromMs)) {
    throw new AnimalRuleError(
      'OUT_OF_ORDER',
      409,
      'This animal has a move on record after that time. Date the change after its last move.'
    );
  }
  const event = insertStatusEvent(common);
  setAnimalStatus(animal.id, animalStatusAfter(input.status), occurredAt, event.reason, now);
  if (!animal.groupId) endStayAt(subject, occurredAt);
  setAnimalGroupAndHousing(animal.id, animal.groupId, null, now);
  return { event, emptied: false };
}

/** The flag the lock rule reads: the stricter side, so a subject that was
 *  ever recorded as food-producing locks. */
export function subjectFoodProducing(subjectType: 'animal' | 'group', subjectId: string): boolean {
  if (subjectType === 'animal') {
    const animal = getAnimal(subjectId);
    return wasEverFoodProducing('animal', subjectId, animal?.foodProducing ?? true);
  }
  const summary = getAnimalGroupSummary(subjectId);
  return wasEverFoodProducing('group', subjectId, summary?.effectiveFoodProducing ?? true);
}

export function statusEventsWithLocks(
  subjectType: 'animal' | 'group',
  subjectId: string,
  now = Date.now()
): Array<AnimalStatusEvent & { locked: boolean }> {
  const food = subjectFoodProducing(subjectType, subjectId);
  return listStatusEvents(subjectType, subjectId).map((e) => {
    const lockedAt = evaluateStatusLock(e, food, now);
    return { ...e, lockedAt: lockedAt ?? null, locked: lockedAt !== undefined };
  });
}

/** Owner-only: removes the latest status change inside the lock window and
 *  puts the subject back the way it was. Older changes are corrected by
 *  recording a new one. */
export function undoStatus(
  eventId: string,
  now = Date.now(),
  by: string | null = null
): { removed: AnimalStatusEvent } {
  const event = getStatusEvent(eventId);
  if (!event) throw new AnimalRuleError('NOT_FOUND', 404, 'Status change not found.');
  const history = listStatusEvents(event.subjectType, event.subjectId);
  if (history.at(-1)?.id !== event.id) {
    throw new AnimalRuleError(
      'NOT_LATEST',
      409,
      'Only the latest status change can be removed. Record a new one to correct an older change.'
    );
  }
  const locked = evaluateStatusLock(
    event,
    subjectFoodProducing(event.subjectType, event.subjectId),
    now
  );
  if (locked !== undefined) {
    throw new AnimalRuleError(
      'RECORD_LOCKED',
      409,
      'This status change is locked (48 hours have passed). Record a new one to correct it.'
    );
  }

  return db.transaction(() => {
    if (event.subjectType === 'group') {
      const group = getAnimalGroup(event.subjectId);
      if (!group) throw new AnimalRuleError('NOT_FOUND', 404, 'Group not found.');
      const next = group.headCount - (event.headCountDelta ?? 0);
      if (next < 0) {
        throw new AnimalRuleError(
          'COUNT_TOO_LOW',
          409,
          'Removing this change would leave the group with fewer than zero animals.'
        );
      }
      deleteStatusEvent(event.id, by);
      setGroupHeadCount(group.id, next, now);
      return { removed: event };
    }
    const animal = getAnimal(event.subjectId);
    if (!animal) throw new AnimalRuleError('NOT_FOUND', 404, 'Animal not found.');
    if (animal.status === 'archived') {
      throw new AnimalRuleError('NOT_ACTIVE', 409, 'This animal is archived. Restore it first.');
    }
    deleteStatusEvent(event.id, by);
    const prior = history.at(-2);
    const subject: Subject = { subjectType: 'animal', subjectId: animal.id };
    if (prior && prior.status !== 'active') {
      if (!animal.groupId && isOutcomeStatus(prior.status)) {
        const stays = listLocationsForSubject('animal', animal.id);
        if (stays.some((s) => s.fromMs > prior.occurredAt)) {
          throw new AnimalRuleError(
            'OUT_OF_ORDER',
            409,
            'This animal has moved since. Record a new status change instead.'
          );
        }
        endStayAt(subject, prior.occurredAt);
      }
      const restored = prior.status === 'sold-for-meat' ? 'sold' : prior.status;
      setAnimalStatus(animal.id, restored, prior.occurredAt, prior.reason, now);
    } else {
      setAnimalStatus(animal.id, 'active', prior?.occurredAt ?? null, prior?.reason ?? null, now);
      if (isOutcomeStatus(event.status) && !animal.groupId) {
        reopenStayEndingAt(subject, event.occurredAt);
      }
    }
    refreshHousingCache(subject, now);
    return { removed: event };
  });
}
