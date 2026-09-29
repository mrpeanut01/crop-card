import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { db } from './client';
import { animalGroups, animalLocations, animals } from './schema';
import { tenantValues, withTenant } from './tenant';
import { hasRecords, insertFlagChange, subjectRecordCounts, type FlagChange } from './animals';
import { effectiveGroupFoodProducing, groupTotal } from '$lib/animals/counts';
import type { AnimalPurpose } from '$lib/animals/model';

export interface AnimalGroup {
  id: string;
  name: string;
  speciesId: string;
  purpose: AnimalPurpose;
  /** Unnamed members only. */
  headCount: number;
  /** The group's own flag; see `effectiveFoodProducing`. */
  foodProducing: boolean;
  housingFieldId: string | null;
  status: 'active' | 'archived';
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AnimalGroupSummary extends AnimalGroup {
  /** Active named members. */
  namedCount: number;
  /** Unnamed plus active named members (`groupTotal`). */
  total: number;
  /** The group's flag OR any active member's (the kernel's value). */
  effectiveFoodProducing: boolean;
}

type GroupRow = typeof animalGroups.$inferSelect;

function rowToGroup(row: GroupRow): AnimalGroup {
  return {
    id: row.id,
    name: row.name,
    speciesId: row.speciesId,
    purpose: row.purpose,
    headCount: row.headCount ?? 0,
    foodProducing: row.foodProducing,
    housingFieldId: row.housingFieldId ?? null,
    status: row.status,
    notes: row.notes ?? null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime()
  };
}

function summarize(groups: AnimalGroup[]): AnimalGroupSummary[] {
  if (groups.length === 0) return [];
  const members = db
    .select({
      groupId: animals.groupId,
      status: animals.status,
      foodProducing: animals.foodProducing
    })
    .from(animals)
    .where(
      withTenant(
        animals,
        inArray(
          animals.groupId,
          groups.map((g) => g.id)
        )
      )
    )
    .all();
  const byGroup = new Map<string, typeof members>();
  for (const m of members) {
    if (!m.groupId) continue;
    const list = byGroup.get(m.groupId) ?? [];
    list.push(m);
    byGroup.set(m.groupId, list);
  }
  return groups.map((g) => {
    const list = byGroup.get(g.id) ?? [];
    return {
      ...g,
      namedCount: list.filter((m) => m.status === 'active').length,
      total: groupTotal(g, list),
      effectiveFoodProducing: effectiveGroupFoodProducing(g, list)
    };
  });
}

export interface ListGroupsOptions {
  status?: 'active' | 'archived' | 'all';
  housingFieldId?: string;
  speciesId?: string;
}

export function listAnimalGroups(opts: ListGroupsOptions = {}): AnimalGroupSummary[] {
  const status = opts.status ?? 'active';
  const rows = db
    .select()
    .from(animalGroups)
    .where(
      withTenant(
        animalGroups,
        status === 'all' ? undefined : eq(animalGroups.status, status),
        opts.housingFieldId ? eq(animalGroups.housingFieldId, opts.housingFieldId) : undefined,
        opts.speciesId ? eq(animalGroups.speciesId, opts.speciesId) : undefined
      )
    )
    .orderBy(asc(animalGroups.createdAt), asc(animalGroups.id))
    .all();
  return summarize(rows.map(rowToGroup));
}

export function getAnimalGroup(id: string): AnimalGroup | undefined {
  const row = db
    .select()
    .from(animalGroups)
    .where(withTenant(animalGroups, eq(animalGroups.id, id)))
    .get();
  return row ? rowToGroup(row) : undefined;
}

export function getAnimalGroupSummary(id: string): AnimalGroupSummary | undefined {
  const group = getAnimalGroup(id);
  return group ? summarize([group])[0] : undefined;
}

export interface CreateGroupInput {
  name: string;
  speciesId: string;
  purpose: AnimalPurpose;
  headCount: number;
  foodProducing: boolean;
  housingFieldId?: string | null;
  notes?: string | null;
}

/** Inserts the row only; the caller writes the first stay. */
export function insertAnimalGroup(input: CreateGroupInput, now = Date.now()): AnimalGroup {
  const row = db
    .insert(animalGroups)
    .values(
      tenantValues({
        id: randomUUID(),
        name: input.name.trim(),
        speciesId: input.speciesId,
        purpose: input.purpose,
        headCount: input.headCount,
        foodProducing: input.foodProducing,
        housingFieldId: input.housingFieldId ?? null,
        notes: input.notes?.trim() || null,
        createdAt: new Date(now),
        updatedAt: new Date(now)
      })
    )
    .returning()
    .get();
  return rowToGroup(row);
}

export interface UpdateGroupInput {
  name?: string;
  purpose?: AnimalPurpose;
  notes?: string | null;
  status?: 'active' | 'archived';
}

export function updateAnimalGroup(id: string, patch: UpdateGroupInput, now = Date.now()) {
  const set: Partial<typeof animalGroups.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.purpose !== undefined) set.purpose = patch.purpose;
  if (patch.notes !== undefined) set.notes = patch.notes?.trim() || null;
  if (patch.status !== undefined) set.status = patch.status;
  if (Object.keys(set).length === 0) return getAnimalGroup(id);
  set.updatedAt = new Date(now);
  const row = db
    .update(animalGroups)
    .set(set)
    .where(withTenant(animalGroups, eq(animalGroups.id, id)))
    .returning()
    .get();
  return row ? rowToGroup(row) : undefined;
}

/** Cache writes used by the move and status paths. */
export function setGroupHeadCount(id: string, headCount: number, now = Date.now()): void {
  if (headCount < 0) throw new Error('head count cannot go below zero');
  db.update(animalGroups)
    .set({ headCount, updatedAt: new Date(now) })
    .where(withTenant(animalGroups, eq(animalGroups.id, id)))
    .run();
}

export function setGroupHousing(id: string, housingFieldId: string | null, now = Date.now()) {
  db.update(animalGroups)
    .set({ housingFieldId, updatedAt: new Date(now) })
    .where(withTenant(animalGroups, eq(animalGroups.id, id)))
    .run();
}

/** @hold-exempt: the food-producing flag is never read by a hold (32C ruling) */
export function setGroupFoodProducing(
  id: string,
  value: boolean,
  reason: string,
  changedBy: string | null,
  now = Date.now()
): FlagChange | null {
  const current = getAnimalGroup(id);
  if (!current || current.foodProducing === value) return null;
  return db.transaction(() => {
    db.update(animalGroups)
      .set({ foodProducing: value, updatedAt: new Date(now) })
      .where(withTenant(animalGroups, eq(animalGroups.id, id)))
      .run();
    return insertFlagChange({
      subjectType: 'group',
      subjectId: id,
      flag: 'food_producing',
      oldValue: current.foodProducing,
      newValue: value,
      reason,
      changedBy,
      changedAt: now
    });
  });
}

/** Any animal row, whatever its status, still pointing at the group. */
export function groupMemberRowCount(id: string): number {
  return Number(
    db
      .select({ n: count() })
      .from(animals)
      .where(withTenant(animals, eq(animals.groupId, id)))
      .get()?.n ?? 0
  );
}

export function activeMemberCount(id: string): number {
  return Number(
    db
      .select({ n: count() })
      .from(animals)
      .where(withTenant(animals, eq(animals.groupId, id), eq(animals.status, 'active')))
      .get()?.n ?? 0
  );
}

/** Deletes a group with no members and no records, with its first stay. */
export function deleteGroupIfEmpty(
  id: string
): 'deleted' | 'has-records' | 'has-members' | 'not-found' {
  return db.transaction(() => {
    if (!getAnimalGroup(id)) return 'not-found';
    if (groupMemberRowCount(id) > 0) return 'has-members';
    if (hasRecords(subjectRecordCounts('group', id))) return 'has-records';
    deleteGroupStays(id);
    db.delete(animalGroups)
      .where(withTenant(animalGroups, eq(animalGroups.id, id)))
      .run();
    return 'deleted';
  });
}

function deleteGroupStays(id: string): void {
  db.delete(animalLocations)
    .where(
      withTenant(
        animalLocations,
        and(eq(animalLocations.subjectType, 'group'), eq(animalLocations.subjectId, id))
      )
    )
    .run();
}
