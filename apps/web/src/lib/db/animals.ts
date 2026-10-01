import { randomUUID } from 'node:crypto';
import {
  type SQL,
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql
} from 'drizzle-orm';
import { db } from './client';
import {
  animalCarePlans,
  animalFlagChanges,
  animalGroups,
  animalHealthEvents,
  animalLocations,
  animalProductionLogs,
  animalStatusEvents,
  animals,
  ledgerEntries
} from './schema';
import { tenantValues, withTenant } from './tenant';
import type { AnimalPurpose, AnimalSex, AnimalStatus, AnimalSubjectType } from '$lib/animals/model';
import { OUTCOME_STATUSES } from '$lib/animals/model';

export interface Animal {
  id: string;
  groupId: string | null;
  speciesId: string;
  breed: string | null;
  name: string | null;
  tag: string | null;
  sex: AnimalSex;
  birthDate: number | null;
  birthDateEstimated: boolean;
  acquiredDate: number | null;
  acquiredFrom: string | null;
  purpose: AnimalPurpose;
  foodProducing: boolean;
  notForSlaughter: boolean;
  status: AnimalStatus;
  statusDate: number | null;
  statusReason: string | null;
  housingFieldId: string | null;
  hasPhoto: boolean;
  notes: string | null;
  microchipId: string | null;
  feedingNote: string | null;
  createdAt: number;
  updatedAt: number;
}

type AnimalRow = typeof animals.$inferSelect;

const msOf = (d: Date | null | undefined): number | null => (d ? d.getTime() : null);
const dateOf = (ms: number | null | undefined): Date | null =>
  ms === null || ms === undefined ? null : new Date(ms);

function rowToAnimal(row: AnimalRow): Animal {
  return {
    id: row.id,
    groupId: row.groupId ?? null,
    speciesId: row.speciesId,
    breed: row.breed ?? null,
    name: row.name ?? null,
    tag: row.tag ?? null,
    sex: row.sex,
    birthDate: msOf(row.birthDate),
    birthDateEstimated: row.birthDateEstimated,
    acquiredDate: msOf(row.acquiredDate),
    acquiredFrom: row.acquiredFrom ?? null,
    purpose: row.purpose,
    foodProducing: row.foodProducing,
    notForSlaughter: row.notForSlaughter,
    status: row.status,
    statusDate: msOf(row.statusDate),
    statusReason: row.statusReason ?? null,
    housingFieldId: row.housingFieldId ?? null,
    hasPhoto: hasPhoto(row),
    notes: row.notes ?? null,
    microchipId: row.microchipId ?? null,
    feedingNote: row.feedingNote ?? null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime()
  };
}

/** `active` animals are here; `gone` covers sold, died, culled and rehomed
 *  (the "No longer here" list); `archived` are hidden from lists and pickers
 *  but keep their history. */
export type AnimalListStatus = 'active' | 'gone' | 'archived' | 'all';

export interface ListAnimalsOptions {
  status?: AnimalListStatus;
  groupId?: string;
  /** Ungrouped animals only when true; grouped only when false. */
  ungrouped?: boolean;
  housingFieldId?: string;
  speciesId?: string;
}

function statusCondition(status: AnimalListStatus) {
  if (status === 'all') return undefined;
  if (status === 'gone') return inArray(animals.status, [...OUTCOME_STATUSES, 'slaughtered']);
  return eq(animals.status, status);
}

export function listAnimals(opts: ListAnimalsOptions = {}): Animal[] {
  return db
    .select()
    .from(animals)
    .where(
      withTenant(
        animals,
        statusCondition(opts.status ?? 'active'),
        opts.groupId ? eq(animals.groupId, opts.groupId) : undefined,
        opts.ungrouped === true
          ? sql`${animals.groupId} is null`
          : opts.ungrouped === false
            ? sql`${animals.groupId} is not null`
            : undefined,
        opts.housingFieldId ? eq(animals.housingFieldId, opts.housingFieldId) : undefined,
        opts.speciesId ? eq(animals.speciesId, opts.speciesId) : undefined
      )
    )
    .orderBy(asc(animals.createdAt), asc(animals.id))
    .all()
    .map(rowToAnimal);
}

export function getAnimal(id: string): Animal | undefined {
  const row = db
    .select()
    .from(animals)
    .where(withTenant(animals, eq(animals.id, id)))
    .get();
  return row ? rowToAnimal(row) : undefined;
}

/** Every member of a group, whatever their status. */
export function listGroupMembers(groupId: string): Animal[] {
  return listAnimals({ status: 'all', groupId });
}

export interface CreateAnimalInput {
  speciesId: string;
  groupId?: string | null;
  name?: string | null;
  tag?: string | null;
  sex?: AnimalSex;
  breed?: string | null;
  birthDate?: number | null;
  birthDateEstimated?: boolean;
  acquiredDate?: number | null;
  acquiredFrom?: string | null;
  purpose: AnimalPurpose;
  foodProducing: boolean;
  housingFieldId?: string | null;
  notes?: string | null;
  microchipId?: string | null;
  feedingNote?: string | null;
}

const blankToNull = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** Inserts the row only; housing history is written by the caller through
 *  `animalLocations.ts` so the cache and the open stay agree. */
export function insertAnimal(input: CreateAnimalInput, now = Date.now()): Animal {
  const row = db
    .insert(animals)
    .values(
      tenantValues({
        id: randomUUID(),
        groupId: input.groupId ?? null,
        speciesId: input.speciesId,
        name: blankToNull(input.name),
        tag: blankToNull(input.tag),
        sex: input.sex ?? 'unknown',
        breed: blankToNull(input.breed),
        birthDate: dateOf(input.birthDate),
        birthDateEstimated: input.birthDateEstimated ?? false,
        acquiredDate: dateOf(input.acquiredDate),
        acquiredFrom: blankToNull(input.acquiredFrom),
        purpose: input.purpose,
        foodProducing: input.foodProducing,
        housingFieldId: input.housingFieldId ?? null,
        notes: blankToNull(input.notes),
        microchipId: blankToNull(input.microchipId),
        feedingNote: blankToNull(input.feedingNote),
        createdAt: new Date(now),
        updatedAt: new Date(now)
      })
    )
    .returning()
    .get();
  return rowToAnimal(row);
}

export interface UpdateAnimalInput {
  name?: string | null;
  tag?: string | null;
  sex?: AnimalSex;
  breed?: string | null;
  birthDate?: number | null;
  birthDateEstimated?: boolean;
  acquiredDate?: number | null;
  acquiredFrom?: string | null;
  purpose?: AnimalPurpose;
  notes?: string | null;
  microchipId?: string | null;
  feedingNote?: string | null;
  status?: 'active' | 'archived';
}

export function updateAnimal(id: string, patch: UpdateAnimalInput, now = Date.now()) {
  const set: Partial<typeof animals.$inferInsert> = {};
  if (patch.name !== undefined) set.name = blankToNull(patch.name);
  if (patch.tag !== undefined) set.tag = blankToNull(patch.tag);
  if (patch.sex !== undefined) set.sex = patch.sex;
  if (patch.breed !== undefined) set.breed = blankToNull(patch.breed);
  if (patch.birthDate !== undefined) set.birthDate = dateOf(patch.birthDate);
  if (patch.birthDateEstimated !== undefined) set.birthDateEstimated = patch.birthDateEstimated;
  if (patch.acquiredDate !== undefined) set.acquiredDate = dateOf(patch.acquiredDate);
  if (patch.acquiredFrom !== undefined) set.acquiredFrom = blankToNull(patch.acquiredFrom);
  if (patch.purpose !== undefined) set.purpose = patch.purpose;
  if (patch.notes !== undefined) set.notes = blankToNull(patch.notes);
  if (patch.microchipId !== undefined) set.microchipId = blankToNull(patch.microchipId);
  if (patch.feedingNote !== undefined) set.feedingNote = blankToNull(patch.feedingNote);
  if (patch.status !== undefined) {
    set.status = patch.status;
    set.statusDate = patch.status === 'archived' ? new Date(now) : null;
    set.statusReason = null;
  }
  if (Object.keys(set).length === 0) return getAnimal(id);
  set.updatedAt = new Date(now);
  const row = db
    .update(animals)
    .set(set)
    .where(withTenant(animals, eq(animals.id, id)))
    .returning()
    .get();
  return row ? rowToAnimal(row) : undefined;
}

/** Status, date and reason written by a status event (or its undo). */
export function setAnimalStatus(
  id: string,
  status: AnimalStatus,
  statusDate: number | null,
  statusReason: string | null,
  now = Date.now()
): void {
  db.update(animals)
    .set({
      status,
      statusDate: dateOf(statusDate),
      statusReason,
      updatedAt: new Date(now)
    })
    .where(withTenant(animals, eq(animals.id, id)))
    .run();
}

/** Internal cache writes used by the move and status paths. */
export function setAnimalGroupAndHousing(
  id: string,
  groupId: string | null,
  housingFieldId: string | null,
  now = Date.now()
): void {
  db.update(animals)
    .set({ groupId, housingFieldId, updatedAt: new Date(now) })
    .where(withTenant(animals, eq(animals.id, id)))
    .run();
}

/** Grouped individuals live where their group lives. */
export function setMembersHousing(groupId: string, housingFieldId: string | null): number {
  return db
    .update(animals)
    .set({ housingFieldId })
    .where(withTenant(animals, eq(animals.groupId, groupId), eq(animals.status, 'active')))
    .run().changes;
}

/** An animal has a photo when either column holds one: the vault document,
 *  or the inline data URL of a row the migration has not moved yet. */
export function hasPhoto(row: {
  photoRef: string | null;
  photoDocumentId: string | null;
}): boolean {
  return !!row.photoRef || !!row.photoDocumentId;
}

/** Stores an inline photo (the vault is off or failed, A-45) or clears the
 *  photo, and clears any vault reference. False when no animal of this
 *  Owner matched.
 *  @hold-exempt: photo columns carry no hold facts */
export function setAnimalPhoto(id: string, photoRef: string | null, now = Date.now()): boolean {
  return writePhoto(id, { photoRef, photoDocumentId: null }, now);
}

/** Points the animal at its photo in the vault (null clears it) and clears
 *  the inline column. False when no animal of this Owner matched.
 *  @hold-exempt: photo columns carry no hold facts */
export function setAnimalPhotoDocument(
  id: string,
  documentId: string | null,
  now = Date.now()
): boolean {
  return writePhoto(id, { photoRef: null, photoDocumentId: documentId }, now);
}

/** @hold-exempt: photo columns carry no hold facts */
function writePhoto(
  id: string,
  set: { photoRef: string | null; photoDocumentId: string | null },
  now: number
): boolean {
  return (
    db
      .update(animals)
      .set({ ...set, updatedAt: new Date(now) })
      .where(withTenant(animals, eq(animals.id, id)))
      .run().changes > 0
  );
}

/** Moves one inline photo to its vault document (A-47): only while
 *  `photo_ref` still holds `expectedRef` and no document is set. Leaves
 *  `updated_at` alone, since nothing the farmer sees changed.
 *  @hold-exempt: photo columns carry no hold facts */
export function moveAnimalPhotoToDocument(
  id: string,
  expectedRef: string,
  documentId: string
): boolean {
  return (
    db
      .update(animals)
      .set({ photoDocumentId: documentId, photoRef: null })
      .where(
        withTenant(
          animals,
          eq(animals.id, id),
          eq(animals.photoRef, expectedRef),
          isNull(animals.photoDocumentId)
        )
      )
      .run().changes > 0
  );
}

export function getAnimalPhoto(id: string): { documentId: string } | { inline: string } | null {
  const row = db
    .select({ photoRef: animals.photoRef, photoDocumentId: animals.photoDocumentId })
    .from(animals)
    .where(withTenant(animals, eq(animals.id, id)))
    .get();
  if (!row) return null;
  if (row.photoDocumentId) return { documentId: row.photoDocumentId };
  return row.photoRef ? { inline: row.photoRef } : null;
}

/** `presumed_lactating` records a sex change that ends the lactating
 *  presumption (C-10), which shortens grazing holds. */
export type AnimalFlag = 'food_producing' | 'not_for_slaughter' | 'presumed_lactating';

export interface FlagChange {
  id: string;
  subjectType: AnimalSubjectType;
  subjectId: string;
  flag: AnimalFlag;
  oldValue: boolean | null;
  newValue: boolean;
  reason: string;
  changedBy: string | null;
  changedAt: number;
}

/** Writes the audit row for a flag change. The caller updates the flag in
 *  the same transaction. */
export function insertFlagChange(input: {
  subjectType: AnimalSubjectType;
  subjectId: string;
  flag: AnimalFlag;
  oldValue: boolean | null;
  newValue: boolean;
  reason: string;
  changedBy: string | null;
  changedAt?: number;
}): FlagChange {
  const row = db
    .insert(animalFlagChanges)
    .values(
      tenantValues({
        id: randomUUID(),
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        flag: input.flag,
        oldValue: input.oldValue,
        newValue: input.newValue,
        reason: input.reason,
        changedBy: input.changedBy,
        changedAt: new Date(input.changedAt ?? Date.now())
      })
    )
    .returning()
    .get();
  return {
    id: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    flag: row.flag,
    oldValue: row.oldValue ?? null,
    newValue: row.newValue,
    reason: row.reason,
    changedBy: row.changedBy ?? null,
    changedAt: row.changedAt.getTime()
  };
}

/** Changes an animal's flag and writes its audit row. Returns null when the
 *  value is unchanged (nothing is written).
 * @hold-exempt: the food-producing flag is never read by a hold (32C ruling)
 */
export function setAnimalFlag(
  id: string,
  flag: 'food_producing' | 'not_for_slaughter',
  value: boolean,
  reason: string,
  changedBy: string | null,
  now = Date.now()
): FlagChange | null {
  const current = getAnimal(id);
  if (!current) return null;
  const old = flag === 'food_producing' ? current.foodProducing : current.notForSlaughter;
  if (old === value) return null;
  return db.transaction(() => {
    db.update(animals)
      .set(
        flag === 'food_producing'
          ? { foodProducing: value, updatedAt: new Date(now) }
          : { notForSlaughter: value, updatedAt: new Date(now) }
      )
      .where(withTenant(animals, eq(animals.id, id)))
      .run();
    return insertFlagChange({
      subjectType: 'animal',
      subjectId: id,
      flag,
      oldValue: old,
      newValue: value,
      reason,
      changedBy,
      changedAt: now
    });
  });
}

export function listFlagChanges(subjectType: AnimalSubjectType, subjectId: string): FlagChange[] {
  return db
    .select()
    .from(animalFlagChanges)
    .where(
      withTenant(
        animalFlagChanges,
        eq(animalFlagChanges.subjectType, subjectType),
        eq(animalFlagChanges.subjectId, subjectId)
      )
    )
    .orderBy(asc(animalFlagChanges.changedAt), asc(animalFlagChanges.id))
    .all()
    .map((row) => ({
      id: row.id,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      flag: row.flag,
      oldValue: row.oldValue ?? null,
      newValue: row.newValue,
      reason: row.reason,
      changedBy: row.changedBy ?? null,
      changedAt: row.changedAt.getTime()
    }));
}

/** True when the subject was ever recorded as food-producing: its flag now
 *  or either side of any audited change. Used for the stricter lock rule. */
export function wasEverFoodProducing(
  subjectType: AnimalSubjectType,
  subjectId: string,
  foodProducingNow: boolean
): boolean {
  if (foodProducingNow) return true;
  return listFlagChanges(subjectType, subjectId).some(
    (c) => c.flag === 'food_producing' && (c.oldValue === true || c.newValue === true)
  );
}

/** Whether the Owner has ever added an animal or a group, in any status.
 *  Monotonic, for the Getting Started item. */
export function hasAnyAnimalRecord(): boolean {
  const animal = db.select({ id: animals.id }).from(animals).where(withTenant(animals)).limit(1);
  const group = db
    .select({ id: animalGroups.id })
    .from(animalGroups)
    .where(withTenant(animalGroups))
    .limit(1);
  const row = db.get<{ found: number }>(sql`select (exists ${animal} or exists ${group}) as found`);
  return row?.found === 1;
}

/** Other active or archived animals carrying this tag (a warning only;
 *  farms reuse tags across species and after culling). */
export function findTagConflicts(tag: string, excludeId?: string): Animal[] {
  const t = tag.trim();
  if (!t) return [];
  return db
    .select()
    .from(animals)
    .where(
      withTenant(
        animals,
        sql`lower(${animals.tag}) = lower(${t})`,
        eq(animals.status, 'active'),
        excludeId ? ne(animals.id, excludeId) : undefined
      )
    )
    .all()
    .map(rowToAnimal);
}

export interface SubjectRecordCounts {
  healthEvents: number;
  productionLogs: number;
  statusEvents: number;
  flagChanges: number;
  carePlans: number;
  ledgerEntries: number;
  /** Stays beyond the first one written when the subject was added. */
  extraLocations: number;
}

function countWhere(n: { n: number } | undefined): number {
  return Number(n?.n ?? 0);
}

/** Care plans the species plugin seeded that nobody has touched: still
 *  `plugin`, on, undated and not one-off. They are suggestions, not
 *  records, so they never block delete-if-empty and go with the subject. */
function untouchedSeedConds(subjectType: AnimalSubjectType, subjectId: string): SQL[] {
  return [
    eq(animalCarePlans.subjectType, subjectType),
    eq(animalCarePlans.subjectId, subjectId),
    eq(animalCarePlans.provenance, 'plugin'),
    eq(animalCarePlans.active, true),
    isNull(animalCarePlans.nextDueAt),
    isNull(animalCarePlans.onceOn)
  ];
}

/** Deletes the subject's untouched seeded care plans (delete-if-empty). */
export function deleteUntouchedSeedPlans(subjectType: AnimalSubjectType, subjectId: string): void {
  db.delete(animalCarePlans)
    .where(withTenant(animalCarePlans, ...untouchedSeedConds(subjectType, subjectId)))
    .run();
}

/** What counts as a record for delete-if-empty. The single stay written
 *  when a subject was added does not, nor do untouched seeded care plans:
 *  a mistaken entry can be deleted in the same session. */
export function subjectRecordCounts(
  subjectType: AnimalSubjectType,
  subjectId: string
): SubjectRecordCounts {
  const subjectOf = <
    T extends
      | typeof animalHealthEvents
      | typeof animalProductionLogs
      | typeof animalStatusEvents
      | typeof animalFlagChanges
      | typeof animalCarePlans
  >(
    t: T
  ) => withTenant(t, eq(t.subjectType, subjectType), eq(t.subjectId, subjectId));
  const own = and(
    eq(animalLocations.subjectType, subjectType),
    eq(animalLocations.subjectId, subjectId)
  );
  const locationCount = (...conds: Array<SQL | undefined>) =>
    countWhere(
      db
        .select({ n: count() })
        .from(animalLocations)
        .where(withTenant(animalLocations, ...conds))
        .get()
    );
  const ownStays = locationCount(own);
  const groupLinked = locationCount(
    own,
    or(isNotNull(animalLocations.fromGroupId), isNotNull(animalLocations.toGroupId))
  );
  const referencing =
    subjectType === 'group'
      ? locationCount(
          ne(animalLocations.subjectId, subjectId),
          or(eq(animalLocations.fromGroupId, subjectId), eq(animalLocations.toGroupId, subjectId))
        )
      : 0;
  const ledger = countWhere(
    db
      .select({ n: count() })
      .from(ledgerEntries)
      .where(
        withTenant(
          ledgerEntries,
          subjectType === 'animal'
            ? eq(ledgerEntries.animalId, subjectId)
            : eq(ledgerEntries.animalGroupId, subjectId)
        )
      )
      .get()
  );
  const n = (t: Parameters<typeof subjectOf>[0]) =>
    countWhere(db.select({ n: count() }).from(t).where(subjectOf(t)).get());
  return {
    healthEvents: n(animalHealthEvents),
    productionLogs: n(animalProductionLogs),
    statusEvents: n(animalStatusEvents),
    flagChanges: n(animalFlagChanges),
    carePlans: Math.max(
      0,
      n(animalCarePlans) -
        countWhere(
          db
            .select({ n: count() })
            .from(animalCarePlans)
            .where(withTenant(animalCarePlans, ...untouchedSeedConds(subjectType, subjectId)))
            .get()
        )
    ),
    ledgerEntries: ledger,
    extraLocations: Math.max(0, ownStays - 1) + groupLinked + referencing
  };
}

export function hasRecords(c: SubjectRecordCounts): boolean {
  return Object.values(c).some((v) => v > 0);
}

/** Deletes an animal that has no records, with its single initial stay. */
export function deleteAnimalIfEmpty(id: string): 'deleted' | 'has-records' | 'not-found' {
  return db.transaction(() => {
    if (!getAnimal(id)) return 'not-found';
    if (hasRecords(subjectRecordCounts('animal', id))) return 'has-records';
    deleteUntouchedSeedPlans('animal', id);
    db.delete(animalLocations)
      .where(
        withTenant(
          animalLocations,
          eq(animalLocations.subjectType, 'animal'),
          eq(animalLocations.subjectId, id)
        )
      )
      .run();
    db.delete(animals)
      .where(withTenant(animals, eq(animals.id, id)))
      .run();
    return 'deleted';
  });
}
