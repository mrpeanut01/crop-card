/**
 * Care plans (Phase 32D, D1). Tenant-scoped: every read and write goes
 * through `withTenant` / `tenantValues`. The care task rows these plans
 * write into `tasks` live in `lib/server/carePlans.ts`.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from './client';
import { animalCarePlans, animalGroups, animals } from './schema';
import { tenantValues, withTenant } from './tenant';
import type { AnimalSubjectType } from '$lib/animals/model';
import { msToYmd, ymdToMs, type CarePlanKind } from '$lib/animals/carePlans';

export type CarePlanProvenance = 'plugin' | 'manual' | 'fallback';

export interface CarePlan {
  id: string;
  subjectType: AnimalSubjectType;
  subjectId: string;
  kind: CarePlanKind;
  title: string;
  productPluginId: string | null;
  intervalDays: number | null;
  /** `YYYY-MM-DD` for a one-off plan. */
  onceOn: string | null;
  /** `YYYY-MM-DD`; null while undated ("ask your vet"). */
  nextDueOn: string | null;
  leadDays: number;
  active: boolean;
  provenance: CarePlanProvenance;
  createdAt: number;
  updatedAt: number;
}

type Row = typeof animalCarePlans.$inferSelect;

const ymdOf = (d: Date | null | undefined): string | null => (d ? msToYmd(d.getTime()) : null);
const dateOf = (ymd: string | null | undefined): Date | null =>
  ymd ? new Date(ymdToMs(ymd)) : null;

function rowTo(row: Row): CarePlan {
  return {
    id: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    kind: row.kind,
    title: row.title,
    productPluginId: row.productPluginId ?? null,
    intervalDays: row.intervalDays ?? null,
    onceOn: ymdOf(row.onceOn),
    nextDueOn: ymdOf(row.nextDueAt),
    leadDays: row.leadDays,
    active: row.active,
    provenance: row.provenance,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime()
  };
}

export function listCarePlansForSubject(
  subjectType: AnimalSubjectType,
  subjectId: string
): CarePlan[] {
  return db
    .select()
    .from(animalCarePlans)
    .where(
      withTenant(
        animalCarePlans,
        and(eq(animalCarePlans.subjectType, subjectType), eq(animalCarePlans.subjectId, subjectId))
      )
    )
    .orderBy(asc(animalCarePlans.createdAt), asc(animalCarePlans.id))
    .all()
    .map(rowTo);
}

export function listCarePlansForSubjects(
  subjects: { subjectType: AnimalSubjectType; subjectId: string }[]
): CarePlan[] {
  const out: CarePlan[] = [];
  for (const type of ['animal', 'group'] as const) {
    const ids = [
      ...new Set(subjects.filter((s) => s.subjectType === type).map((s) => s.subjectId))
    ];
    for (let i = 0; i < ids.length; i += 500) {
      out.push(
        ...db
          .select()
          .from(animalCarePlans)
          .where(
            withTenant(
              animalCarePlans,
              and(
                eq(animalCarePlans.subjectType, type),
                inArray(animalCarePlans.subjectId, ids.slice(i, i + 500))
              )
            )
          )
          .all()
          .map(rowTo)
      );
    }
  }
  return out;
}

/** Active plans with a due date: the ones that can have a task. */
export function listActiveDatedCarePlans(): CarePlan[] {
  return db
    .select()
    .from(animalCarePlans)
    .where(withTenant(animalCarePlans, eq(animalCarePlans.active, true)))
    .orderBy(asc(animalCarePlans.nextDueAt))
    .all()
    .map(rowTo)
    .filter((p) => p.nextDueOn !== null);
}

export function getCarePlan(id: string): CarePlan | undefined {
  const row = db
    .select()
    .from(animalCarePlans)
    .where(withTenant(animalCarePlans, eq(animalCarePlans.id, id)))
    .get();
  return row ? rowTo(row) : undefined;
}

export interface CarePlanInsert {
  subjectType: AnimalSubjectType;
  subjectId: string;
  kind: CarePlanKind;
  title: string;
  productPluginId?: string | null;
  intervalDays?: number | null;
  onceOn?: string | null;
  nextDueOn?: string | null;
  leadDays: number;
  active?: boolean;
  provenance: CarePlanProvenance;
}

export function insertCarePlan(input: CarePlanInsert, now = Date.now()): CarePlan {
  const row = db
    .insert(animalCarePlans)
    .values(
      tenantValues({
        id: randomUUID(),
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        kind: input.kind,
        title: input.title,
        productPluginId: input.productPluginId ?? null,
        intervalDays: input.intervalDays ?? null,
        onceOn: dateOf(input.onceOn),
        nextDueAt: dateOf(input.nextDueOn),
        leadDays: input.leadDays,
        active: input.active ?? true,
        provenance: input.provenance,
        createdAt: new Date(now),
        updatedAt: new Date(now)
      })
    )
    .returning()
    .get();
  return rowTo(row);
}

export interface CarePlanUpdate {
  kind?: CarePlanKind;
  title?: string;
  productPluginId?: string | null;
  intervalDays?: number | null;
  onceOn?: string | null;
  nextDueOn?: string | null;
  leadDays?: number;
  active?: boolean;
  provenance?: CarePlanProvenance;
}

export function updateCarePlan(
  id: string,
  patch: CarePlanUpdate,
  now = Date.now()
): CarePlan | undefined {
  const set: Partial<typeof animalCarePlans.$inferInsert> = { updatedAt: new Date(now) };
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.productPluginId !== undefined) set.productPluginId = patch.productPluginId;
  if (patch.intervalDays !== undefined) set.intervalDays = patch.intervalDays;
  if (patch.onceOn !== undefined) set.onceOn = dateOf(patch.onceOn);
  if (patch.nextDueOn !== undefined) set.nextDueAt = dateOf(patch.nextDueOn);
  if (patch.leadDays !== undefined) set.leadDays = patch.leadDays;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.provenance !== undefined) set.provenance = patch.provenance;
  const row = db
    .update(animalCarePlans)
    .set(set)
    .where(withTenant(animalCarePlans, eq(animalCarePlans.id, id)))
    .returning()
    .get();
  return row ? rowTo(row) : undefined;
}

export function deleteCarePlan(id: string): boolean {
  const res = db
    .delete(animalCarePlans)
    .where(withTenant(animalCarePlans, eq(animalCarePlans.id, id)))
    .run();
  return res.changes > 0;
}

/** D0-3: a group split copies the group's plans to the new group. */
export function copyCarePlans(fromGroupId: string, toGroupId: string, now = Date.now()): number {
  let n = 0;
  for (const p of listCarePlansForSubject('group', fromGroupId)) {
    insertCarePlan(
      {
        subjectType: 'group',
        subjectId: toGroupId,
        kind: p.kind,
        title: p.title,
        productPluginId: p.productPluginId,
        intervalDays: p.intervalDays,
        onceOn: p.onceOn,
        nextDueOn: p.nextDueOn,
        leadDays: p.leadDays,
        active: p.active,
        provenance: p.provenance
      },
      now
    );
    n++;
  }
  return n;
}

/** Who a plan is for, as the care engine needs it. */
export interface CareSubject {
  subjectType: AnimalSubjectType;
  subjectId: string;
  name: string;
  speciesId: string;
  /** Still here: an active animal, or a group that is not archived. */
  active: boolean;
  /** The group an animal belongs to (for the group roll-up). */
  groupId: string | null;
  /** The subject's own flag, for what the close form asks. */
  foodProducing: boolean;
}

export function careSubjectKey(subjectType: AnimalSubjectType, subjectId: string): string {
  return `${subjectType}:${subjectId}`;
}

/** Names and status for many subjects in two queries. */
export function careSubjects(
  subjects: { subjectType: AnimalSubjectType; subjectId: string }[]
): Map<string, CareSubject> {
  const out = new Map<string, CareSubject>();
  const animalIds = [
    ...new Set(subjects.filter((s) => s.subjectType === 'animal').map((s) => s.subjectId))
  ];
  const groupIds = [
    ...new Set(subjects.filter((s) => s.subjectType === 'group').map((s) => s.subjectId))
  ];
  for (let i = 0; i < animalIds.length; i += 500) {
    for (const a of db
      .select({
        id: animals.id,
        name: animals.name,
        tag: animals.tag,
        status: animals.status,
        groupId: animals.groupId,
        speciesId: animals.speciesId,
        foodProducing: animals.foodProducing
      })
      .from(animals)
      .where(withTenant(animals, inArray(animals.id, animalIds.slice(i, i + 500))))
      .all()) {
      out.set(careSubjectKey('animal', a.id), {
        subjectType: 'animal',
        subjectId: a.id,
        name: a.name ?? (a.tag ? `Tag ${a.tag}` : 'An animal'),
        speciesId: a.speciesId,
        active: a.status === 'active',
        groupId: a.groupId ?? null,
        foodProducing: a.foodProducing
      });
    }
  }
  for (let i = 0; i < groupIds.length; i += 500) {
    for (const g of db
      .select({
        id: animalGroups.id,
        name: animalGroups.name,
        status: animalGroups.status,
        speciesId: animalGroups.speciesId,
        foodProducing: animalGroups.foodProducing
      })
      .from(animalGroups)
      .where(withTenant(animalGroups, inArray(animalGroups.id, groupIds.slice(i, i + 500))))
      .all()) {
      out.set(careSubjectKey('group', g.id), {
        subjectType: 'group',
        subjectId: g.id,
        name: g.name,
        speciesId: g.speciesId,
        active: g.status === 'active',
        groupId: null,
        foodProducing: g.foodProducing
      });
    }
  }
  return out;
}
