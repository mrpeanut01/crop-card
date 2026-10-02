/**
 * Who lives on an Area and its grazing holds, on the offline Area Card
 * (32D). Built from the snapshot's animals and the kernel's precomputed
 * Area holds with the same helpers the live Area Card uses. Bundles with
 * no animal data (older ones, or the live pages' own snapshot) come back
 * unchanged.
 */

import {
  withGrazing,
  type AreaGrazing,
  type GrazingHold
} from '$lib/farm/areaGrazing';
import { withHousing, type AreaHousing } from '$lib/farm/housedAnimals';
import type { CardModel } from '../model';
import type { FarmSnapshot, SnapshotAreaHold } from '../snapshot';
import type { ResolvedOptions } from './common';

export function housingFromSnapshot(snapshot: FarmSnapshot, areaId: string): AreaHousing | null {
  if (!snapshot.animals || !snapshot.animalGroups) return null;
  const species = snapshot.species ?? {};
  const groups = snapshot.animalGroups
    .filter((g) => g.housingFieldId === areaId)
    .map((g) => ({
      id: g.id,
      name: g.name,
      speciesPlural: species[g.speciesId]?.label ?? 'Animals',
      total: g.total,
      foodProducing: g.foodProducing
    }));
  const animals = snapshot.animals
    .filter((a) => !a.groupId && a.housingFieldId === areaId)
    .map((a) => ({
      id: a.id,
      name: a.name,
      tag: a.tag,
      speciesName: species[a.speciesId]?.displayName ?? 'Animal',
      purpose: a.purpose,
      foodProducing: a.foodProducing
    }));
  if (!groups.length && !animals.length) return null;
  return {
    groups,
    animals,
    total: groups.reduce((n, g) => n + g.total, 0) + animals.length,
    capacity: null
  };
}

function holdOf(holds: readonly SnapshotAreaHold[]): GrazingHold | null {
  if (!holds.length) return null;
  const prohibited = holds.find((h) => h.status === 'prohibited');
  if (prohibited) return { state: 'prohibited', clearsAtMs: null, products: [] };
  if (holds.some((h) => h.status === 'unknown' || h.clearMs === null)) {
    return { state: 'unknown', clearsAtMs: null, products: [] };
  }
  return {
    state: 'dated',
    clearsAtMs: Math.max(...holds.map((h) => h.clearMs as number)),
    products: []
  };
}

export function grazingFromSnapshot(
  snapshot: FarmSnapshot,
  areaId: string,
  now: number
): AreaGrazing | null {
  const open = (snapshot.areaHolds ?? []).filter(
    (h) => h.areaId === areaId && (h.clearMs === null || h.clearMs > now)
  );
  const graze = holdOf(open.filter((h) => h.kind === 'graze'));
  const hay = holdOf(open.filter((h) => h.kind === 'hay'));
  if (!graze && !hay) return null;
  return { graze, milking: null, hay, manureCarryover: false, attested: false };
}

export function withSnapshotAnimals(
  snapshot: FarmSnapshot,
  areaId: string,
  card: CardModel,
  opts: ResolvedOptions
): CardModel {
  if (!snapshot.animals) return card;
  const housed = withHousing(card, housingFromSnapshot(snapshot, areaId), {
    petsLayout: snapshot.animalsLayout === 'pets',
    locale: opts.prefs.locale
  });
  const tz = snapshot.holdTimeZone || opts.prefs.timeZone;
  return withGrazing(housed, grazingFromSnapshot(snapshot, areaId, opts.now), tz);
}
