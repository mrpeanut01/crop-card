import { json } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db/client';
import {
  animalGroups,
  animals,
  fields,
  helperAssignments,
  stockLots,
  type ANIMAL_SUBJECT_TYPES
} from '$lib/db/schema';
import { requireOwnerId, withTenant } from '$lib/db/tenant';

/**
 * Invariant 6 — a row stamped with the caller's owner_id must not reference
 * another Owner's rows. SQLite FKs don't help (the foreign row exists), so
 * each id taken from a request body is resolved through its tenant-scoped
 * getter, which returns undefined for another Owner's ids.
 */
export type ForeignRef = readonly [
  field: string,
  id: string | null | undefined,
  exists: (id: string) => unknown
];

export function firstUnknownRef(...refs: ForeignRef[]): string | null {
  for (const [field, id, exists] of refs) {
    if (id && !exists(id)) return field;
  }
  return null;
}

/** 400 `{ error: 'unknown <field>' }` for the first unresolvable reference. */
export function rejectForeignRefs(...refs: ForeignRef[]): Response | null {
  const field = firstUnknownRef(...refs);
  return field ? json({ error: `unknown ${field}` }, { status: 400 }) : null;
}

export type AnimalSubjectType = (typeof ANIMAL_SUBJECT_TYPES)[number];

function animalExists(id: string): boolean {
  return (
    db
      .select({ id: animals.id })
      .from(animals)
      .where(withTenant(animals, eq(animals.id, id)))
      .get() !== undefined
  );
}

function animalGroupExists(id: string): boolean {
  return (
    db
      .select({ id: animalGroups.id })
      .from(animalGroups)
      .where(withTenant(animalGroups, eq(animalGroups.id, id)))
      .get() !== undefined
  );
}

/** An animal or group of this Owner, matched against the stated subject
 *  type, so a group id sent as `animal` is refused. */
export function assertAnimalSubject(
  field: string,
  subjectType: string | null | undefined,
  subjectId: string | null | undefined
): ForeignRef {
  return [
    field,
    subjectId,
    (id) =>
      subjectType === 'animal'
        ? animalExists(id)
        : subjectType === 'group'
          ? animalGroupExists(id)
          : false
  ];
}

const ASSIGNABLE_ROLES = ['owner', 'helper', 'custom-operator'] as const;

/** A user with an active, working (non-inspector) assignment on this Owner. */
export function assertAssignableUser(field: string, userId: string | null | undefined): ForeignRef {
  return [
    field,
    userId,
    (id) =>
      db
        .select({ userId: helperAssignments.userId })
        .from(helperAssignments)
        .where(
          and(
            eq(helperAssignments.ownerId, requireOwnerId()),
            eq(helperAssignments.userId, id),
            eq(helperAssignments.status, 'active'),
            inArray(helperAssignments.roleWithinOwner, [...ASSIGNABLE_ROLES])
          )
        )
        .get() !== undefined
  ];
}

export function assertStockLot(field: string, lotId: string | null | undefined): ForeignRef {
  return [
    field,
    lotId,
    (id) =>
      db
        .select({ id: stockLots.id })
        .from(stockLots)
        .where(withTenant(stockLots, eq(stockLots.id, id)))
        .get() !== undefined
  ];
}

/** Any Area (`fields` row) of this Owner. */
export function assertField(field: string, fieldId: string | null | undefined): ForeignRef {
  return [
    field,
    fieldId,
    (id) =>
      db
        .select({ id: fields.id })
        .from(fields)
        .where(withTenant(fields, eq(fields.id, id)))
        .get() !== undefined
  ];
}
