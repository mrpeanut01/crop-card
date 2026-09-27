import { randomUUID } from 'node:crypto';
import { asc, eq, isNull } from 'drizzle-orm';
import { db } from './client';
import { animalLocations } from './schema';
import { tenantValues, withTenant } from './tenant';
import {
  getAnimal,
  listAnimals,
  setAnimalGroupAndHousing,
  setMembersHousing,
  type Animal
} from './animals';
import {
  getAnimalGroup,
  listAnimalGroups,
  setGroupHousing,
  type AnimalGroupSummary
} from './animalGroups';
import type { AnimalSubjectType } from '$lib/animals/model';
import { openStay, planStayInsert, stayAt } from '$lib/animals/timeline';

export interface AnimalLocation {
  id: string;
  subjectType: AnimalSubjectType;
  subjectId: string;
  fieldId: string;
  fromMs: number;
  toMs: number | null;
  movedBy: string | null;
  fromGroupId: string | null;
  toGroupId: string | null;
  clientRecordId: string | null;
  createdAt: number;
}

type LocationRow = typeof animalLocations.$inferSelect;

function rowToLocation(row: LocationRow): AnimalLocation {
  return {
    id: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    fieldId: row.fieldId,
    fromMs: row.fromMs.getTime(),
    toMs: row.toMs ? row.toMs.getTime() : null,
    movedBy: row.movedBy ?? null,
    fromGroupId: row.fromGroupId ?? null,
    toGroupId: row.toGroupId ?? null,
    clientRecordId: row.clientRecordId ?? null,
    createdAt: row.createdAt.getTime()
  };
}

export interface Subject {
  subjectType: AnimalSubjectType;
  subjectId: string;
}

/** A subject's stays, oldest first. */
export function listLocationsForSubject(
  subjectType: AnimalSubjectType,
  subjectId: string
): AnimalLocation[] {
  return db
    .select()
    .from(animalLocations)
    .where(
      withTenant(
        animalLocations,
        eq(animalLocations.subjectType, subjectType),
        eq(animalLocations.subjectId, subjectId)
      )
    )
    .orderBy(asc(animalLocations.fromMs), asc(animalLocations.createdAt))
    .all()
    .map(rowToLocation);
}

export function getLocation(id: string): AnimalLocation | undefined {
  const row = db
    .select()
    .from(animalLocations)
    .where(withTenant(animalLocations, eq(animalLocations.id, id)))
    .get();
  return row ? rowToLocation(row) : undefined;
}

/** Every stay on an Area, oldest first. `openOnly` keeps the current ones. */
export function listLocationsOnField(
  fieldId: string,
  opts: { openOnly?: boolean } = {}
): AnimalLocation[] {
  return db
    .select()
    .from(animalLocations)
    .where(
      withTenant(
        animalLocations,
        eq(animalLocations.fieldId, fieldId),
        opts.openOnly ? isNull(animalLocations.toMs) : undefined
      )
    )
    .orderBy(asc(animalLocations.fromMs), asc(animalLocations.createdAt))
    .all()
    .map(rowToLocation);
}

function setStayEnd(id: string, toMs: number | null, toGroupId?: string | null): void {
  db.update(animalLocations)
    .set({
      toMs: toMs === null ? null : new Date(toMs),
      ...(toGroupId !== undefined ? { toGroupId } : {})
    })
    .where(withTenant(animalLocations, eq(animalLocations.id, id)))
    .run();
}

function insertRow(input: {
  subject: Subject;
  fieldId: string;
  fromMs: number;
  toMs: number | null;
  movedBy: string | null;
  fromGroupId?: string | null;
  toGroupId?: string | null;
  clientRecordId?: string | null;
}): AnimalLocation {
  return rowToLocation(
    db
      .insert(animalLocations)
      .values(
        tenantValues({
          id: randomUUID(),
          subjectType: input.subject.subjectType,
          subjectId: input.subject.subjectId,
          fieldId: input.fieldId,
          fromMs: new Date(input.fromMs),
          toMs: input.toMs === null ? null : new Date(input.toMs),
          movedBy: input.movedBy,
          fromGroupId: input.fromGroupId ?? null,
          toGroupId: input.toGroupId ?? null,
          clientRecordId: input.clientRecordId ?? null
        })
      )
      .returning()
      .get()
  );
}

export type StayInsertResult =
  { ok: true; location: AnimalLocation } | { ok: false; reason: 'same-time' };

/** Slots a stay starting at `atMs` into the subject's timeline: the stay
 *  covering that moment is cut short there, and the new one ends where that
 *  stay ended or where the next recorded stay begins. Keeps every timeline
 *  non-overlapping however moves arrive. Does not touch the housing cache;
 *  call `refreshHousingCache` after. */
export function insertStay(input: {
  subject: Subject;
  fieldId: string;
  atMs: number;
  movedBy: string | null;
  fromGroupId?: string | null;
  clientRecordId?: string | null;
}): StayInsertResult {
  const stays = listLocationsForSubject(input.subject.subjectType, input.subject.subjectId);
  const plan = planStayInsert(stays, input.atMs);
  if (!plan.ok) return plan;
  if (plan.truncate) setStayEnd(plan.truncate.id, plan.truncate.toMs);
  const location = insertRow({
    subject: input.subject,
    fieldId: input.fieldId,
    fromMs: input.atMs,
    toMs: plan.toMs,
    movedBy: input.movedBy,
    fromGroupId: input.fromGroupId,
    clientRecordId: input.clientRecordId
  });
  return { ok: true, location };
}

/** A zero-length row that records a group change at an Area without taking
 *  up time (an individual joining a flock, or moving between flocks). */
export function insertGroupChangeMarker(input: {
  subject: Subject;
  fieldId: string;
  atMs: number;
  movedBy: string | null;
  fromGroupId: string | null;
  toGroupId: string | null;
  clientRecordId?: string | null;
}): AnimalLocation {
  return insertRow({ ...input, fromMs: input.atMs, toMs: input.atMs });
}

/** Ends the stay covering `atMs` there, marking the group the subject went
 *  into, if any. Returns the closed stay, or null when nothing covered it. */
export function endStayAt(
  subject: Subject,
  atMs: number,
  toGroupId: string | null = null
): AnimalLocation | null {
  const stays = listLocationsForSubject(subject.subjectType, subject.subjectId);
  const covering = stayAt(stays, atMs);
  if (!covering) return null;
  setStayEnd(covering.id, atMs, toGroupId);
  return { ...covering, toMs: atMs, toGroupId };
}

/** Undoes `endStayAt`: reopens the subject's latest stay when it ended at
 *  exactly `atMs` without going into a group. */
export function reopenStayEndingAt(subject: Subject, atMs: number): AnimalLocation | null {
  const stays = listLocationsForSubject(subject.subjectType, subject.subjectId);
  const latest = stays[stays.length - 1];
  if (!latest || latest.toMs !== atMs || latest.toGroupId) return null;
  setStayEnd(latest.id, null);
  return { ...latest, toMs: null };
}

/** The Area the subject lives on now: a grouped individual lives where its
 *  group lives; everyone else lives at their open stay. */
export function currentHousing(subject: Subject): string | null {
  if (subject.subjectType === 'animal') {
    const animal = getAnimal(subject.subjectId);
    if (!animal) return null;
    if (animal.status !== 'active') return null;
    if (animal.groupId) return getAnimalGroup(animal.groupId)?.housingFieldId ?? null;
  }
  const open = openStay(listLocationsForSubject(subject.subjectType, subject.subjectId));
  return open?.fieldId ?? null;
}

/** Rewrites the `housing_field_id` cache from the timeline. A group's
 *  active members follow the group. */
export function refreshHousingCache(subject: Subject, now = Date.now()): string | null {
  if (subject.subjectType === 'group') {
    const open = openStay(listLocationsForSubject('group', subject.subjectId));
    const fieldId = open?.fieldId ?? null;
    setGroupHousing(subject.subjectId, fieldId, now);
    setMembersHousing(subject.subjectId, fieldId);
    return fieldId;
  }
  const animal = getAnimal(subject.subjectId);
  if (!animal) return null;
  const fieldId = currentHousing(subject);
  setAnimalGroupAndHousing(animal.id, animal.groupId, fieldId, now);
  return fieldId;
}

export type UndoStayResult =
  | { ok: true; reopened: AnimalLocation | null }
  | { ok: false; reason: 'not-found' | 'not-latest' | 'group-change' };

/** Deletes a subject's latest stay and reopens the one before it when they
 *  met end to end. Stays that record a group change are not undone here. */
export function deleteLatestStay(id: string): UndoStayResult {
  const target = getLocation(id);
  if (!target) return { ok: false, reason: 'not-found' };
  const stays = listLocationsForSubject(target.subjectType, target.subjectId);
  const latest = stays[stays.length - 1];
  if (!latest || latest.id !== target.id) return { ok: false, reason: 'not-latest' };
  if (target.fromGroupId || target.toGroupId) return { ok: false, reason: 'group-change' };
  db.delete(animalLocations)
    .where(withTenant(animalLocations, eq(animalLocations.id, id)))
    .run();
  const prior = stays[stays.length - 2];
  let reopened: AnimalLocation | null = null;
  if (prior && prior.toMs === target.fromMs && !prior.toGroupId) {
    setStayEnd(prior.id, target.toMs);
    reopened = { ...prior, toMs: target.toMs };
  }
  refreshHousingCache(target);
  return { ok: true, reopened };
}

export interface HousedOnField {
  groups: AnimalGroupSummary[];
  /** Active individuals living here outside any group. */
  animals: Animal[];
  /** Everyone here: each group's total plus the individuals. */
  total: number;
}

/** Who lives on an Area now, for the Area Card and the farm map sheet. */
export function housedOnField(fieldId: string): HousedOnField {
  const groups = listAnimalGroups({ status: 'active', housingFieldId: fieldId });
  const individuals = listAnimals({ status: 'active', housingFieldId: fieldId, ungrouped: true });
  const total = groups.reduce((n, g) => n + g.total, 0) + individuals.length;
  return { groups, animals: individuals, total };
}

/** Active groups and individuals housed on the Area (a group counts once). */
export function housedSubjectCount(fieldId: string): number {
  const here = housedOnField(fieldId);
  return here.groups.length + here.animals.length;
}

/** Head on the Area once `adding` more arrive. */
export function headCountAfterArrival(fieldId: string, adding: number): number {
  return housedOnField(fieldId).total + adding;
}
