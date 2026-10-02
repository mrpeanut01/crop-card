/**
 * 33B server side of animal organic status: gathers entries, membership
 * history, treatments, dosed tombstones and reviews for the active Owner
 * and runs the pure projection in `./animalStatus`. Reads only.
 */

import { listAnimals } from '$lib/db/animals';
import { listAnimalGroups } from '$lib/db/animalGroups';
import { listAllLocations, type AnimalLocation } from '$lib/db/animalLocations';
import { listAllHealthEvents, listAllHealthTombstones } from '$lib/db/animalHealth';
import { listOrganicReviews } from '$lib/db/organicReviews';
import { listOrganicStatusEntries } from '$lib/db/organicStatus';
import { documentPeople } from '$lib/db/documents';
import { membershipsFromStays } from '$lib/animals/membership';
import { HOLD_BEARING_KINDS, type GroupMembership } from '$lib/safety/animalWithdrawal';
import { identityLabel } from '$lib/identity';
import { NOP_RULES } from './nopRules';
import type { EffectiveOrganicStatus, OrganicStatusEntry } from './status';
import {
  projectAnimalOrganic,
  subjectKey,
  type AnimalOrganicProjection,
  type AnimalOrganicSubject,
  type AnimalOrganicWorld,
  type OrganicTreatmentInput,
  type OrganicUseFact,
  type TreatmentOrganicRow,
  type TreatmentReviewView
} from './animalStatus';

export type { TreatmentOrganicRow } from './animalStatus';

export type OrganicHealthPluginLookup = (
  pluginId: string
) => { productKind: string; displayName?: string; organicUse?: OrganicUseFact } | undefined;

const EMPTY: AnimalOrganicProjection = {
  rows: [],
  losses: new Map(),
  statusAt: () => null
};

function overlaps(m: GroupMembership, fromMs: number, toMs: number): boolean {
  return (m.fromMs === null || m.fromMs <= toMs) && (m.toMs === null || m.toMs > fromMs);
}

/** The whole farm's projection. A farm with no animal or group status
 *  entry pays one read. */
export function animalOrganicProjection(
  plugins: OrganicHealthPluginLookup = () => undefined
): AnimalOrganicProjection {
  const entries = listOrganicStatusEntries().filter(
    (e) => e.subjectType === 'animal' || e.subjectType === 'group'
  );
  if (entries.length === 0) return EMPTY;
  const byKey = new Map<string, OrganicStatusEntry[]>();
  for (const e of entries) {
    const key = `${e.subjectType}:${e.subjectId}`;
    byKey.set(key, [...(byKey.get(key) ?? []), e]);
  }
  const groupNames = new Map(listAnimalGroups({ status: 'all' }).map((g) => [g.id, g.name]));
  const animals = listAnimals({ status: 'all' });
  const staysByAnimal = new Map<string, AnimalLocation[]>();
  for (const l of listAllLocations()) {
    if (l.subjectType !== 'animal') continue;
    staysByAnimal.set(l.subjectId, [...(staysByAnimal.get(l.subjectId) ?? []), l]);
  }
  const memberships = new Map<string, GroupMembership[]>(
    animals.map((a) => [a.id, membershipsFromStays(a.groupId, staysByAnimal.get(a.id) ?? [])])
  );

  const reviews = new Map(listOrganicReviews().map((r) => [r.healthEventId, r]));
  const tombstones = listAllHealthTombstones().filter(
    (t) => t.dosed && HOLD_BEARING_KINDS.includes(t.event.kind)
  );
  const people = documentPeople([
    ...[...reviews.values()].map((r) => r.createdBy),
    ...tombstones.map((t) => t.organicReview?.createdBy ?? null)
  ]);
  const view = (
    r:
      | {
          outcome: TreatmentReviewView['outcome'];
          reason: string;
          createdAt: number;
          lockedAt: number | null;
          createdBy: string | null;
        }
      | null
      | undefined
  ): TreatmentReviewView | null => {
    if (!r) return null;
    const who = r.createdBy ? people.get(r.createdBy) : undefined;
    return {
      outcome: r.outcome,
      reason: r.reason,
      createdAt: r.createdAt,
      lockedAt: r.lockedAt,
      by: r.createdBy
        ? { id: r.createdBy, label: who ? identityLabel(who) : 'A former member' }
        : null
    };
  };
  const productOf = (e: { productName: string | null; productPluginId: string | null }) =>
    e.productName ??
    (e.productPluginId ? plugins(e.productPluginId)?.displayName : undefined) ??
    e.productPluginId ??
    'Product not named';

  const treatments: OrganicTreatmentInput[] = [
    ...listAllHealthEvents()
      .filter((e) => HOLD_BEARING_KINDS.includes(e.kind))
      .map((e) => ({
        healthEventId: e.id,
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        administeredAt: e.administeredAt,
        courseEndAt: e.courseEndAt,
        product: productOf(e),
        pluginId: e.productPluginId,
        deleted: false,
        review: view(reviews.get(e.id))
      })),
    ...tombstones.map((t) => ({
      healthEventId: t.recordId,
      subjectType: t.event.subjectType,
      subjectId: t.event.subjectId,
      administeredAt: t.event.administeredAt,
      courseEndAt: t.event.courseEndAt,
      product: productOf(t.event),
      pluginId: t.event.productPluginId,
      deleted: true,
      review: view(t.organicReview)
    }))
  ];

  const world: AnimalOrganicWorld = {
    entries: (s) => byKey.get(subjectKey(s)) ?? [],
    groupName: (id) => groupNames.get(id) ?? 'a former group',
    groupsAt: (animalId, atMs) =>
      (memberships.get(animalId) ?? [])
        .filter((m) => overlaps(m, atMs, atMs))
        .map((m) => m.groupId),
    membersDuring: (groupId, fromMs, toMs) =>
      animals
        .filter((a) =>
          (memberships.get(a.id) ?? []).some(
            (m) => m.groupId === groupId && overlaps(m, fromMs, toMs)
          )
        )
        .map((a) => a.id),
    plugin: (id) => plugins(id),
    rules: NOP_RULES
  };
  return projectAnimalOrganic(treatments, world);
}

/** C-B1: every treatment that needed an organic outcome, oldest first. */
export function organicTreatmentOutcomes(
  opts: { fromMs?: number; toMs?: number; plugins?: OrganicHealthPluginLookup } = {}
): TreatmentOrganicRow[] {
  return animalOrganicProjection(opts.plugins).rows.filter(
    (r) =>
      (opts.fromMs === undefined || r.administeredAt >= opts.fromMs) &&
      (opts.toMs === undefined || r.administeredAt <= opts.toMs)
  );
}

export function animalOrganicStatusAt(
  subject: AnimalOrganicSubject,
  atMs: number,
  plugins?: OrganicHealthPluginLookup
): EffectiveOrganicStatus | null {
  return animalOrganicProjection(plugins).statusAt(subject, atMs);
}

/** B-24: how many of a group's current members lost status by their own
 *  treatment; the group itself is unchanged. */
export function groupMembersLost(projection: AnimalOrganicProjection, groupId: string): number {
  return listAnimals({ groupId }).filter((a) => projection.losses.has(`animal:${a.id}`)).length;
}
