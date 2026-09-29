/**
 * Test-only helpers for the C-35 hold guard tests: a registry with two
 * herbicides (one with label grazing data, one without) and chickens, a
 * small farm and the four caller tiers the guard tells apart.
 */

import { randomUUID } from 'node:crypto';
import { db } from '$lib/db/client';
import { equipment, owners, users } from '$lib/db/schema';
import { tenantValues } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import { insertAnimalGroup } from '$lib/db/animalGroups';
import { insertAnimal } from '$lib/db/animals';
import { insertStay } from '$lib/db/animalLocations';
import type { GuardUser } from './holdGuard';

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const TEST_USER = 'hold-guard-user';

/** Label grazing data: grazing and haying 10 days after the spray. */
export const KNOWN_HERBICIDE = {
  pluginId: 'guard-known',
  type: 'herbicide',
  displayName: 'Known label',
  activeIngredients: [],
  grazingRestrictions: {
    source: 'test label',
    grazeDays: 10,
    hayDays: 10,
    lactatingDairyGrazeDays: 10,
    meatAnimalRemovalBeforeSlaughterDays: 3
  }
};

/** A plugin the registry does not know: its grazing interval is unknown. */
export const UNKNOWN_HERBICIDE_ID = 'guard-unsourced';

export const CHICKEN = {
  pluginId: 'chicken',
  displayName: 'Chicken',
  foodProducingDefault: true,
  products: ['eggs', 'meat']
};

export type Tier = 'owner' | 'helper' | 'bearer' | 'impersonating';
export const TIERS: readonly Tier[] = ['owner', 'helper', 'bearer', 'impersonating'];

export function guardUser(tier: Tier): GuardUser {
  return {
    id: TEST_USER,
    role: tier === 'helper' ? 'helper' : 'owner',
    impersonating: tier === 'impersonating'
  };
}

export function guardEvent(tier: Tier) {
  return {
    locals: tier === 'bearer' ? { authVia: 'bearer' } : {},
    request: new Request('http://localhost/api/test', { method: 'POST' })
  } as never;
}

export function seedOwner(prefix = 'guard'): string {
  const id = `${prefix}-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users).values({ id: TEST_USER, email: 'guard@test.local' }).onConflictDoNothing().run();
  return id;
}

export interface Farm {
  barnId: string;
  pastureId: string;
  otherPastureId: string;
  blockId: string;
  otherBlockId: string;
  sprayerId: string;
  groupId: string;
  henId: string;
}

/** A barn, two pastures with one block each, a sprayer and a flock of
 *  chickens (with one named hen) living in the barn since `sinceMs`. */
export function seedFarm(sinceMs: number): Farm {
  const barnId = createField({ name: 'Barn', kind: 'barn' }).id;
  const pasture = createField({ name: 'North pasture', kind: 'pasture' });
  const other = createField({ name: 'South pasture', kind: 'pasture' });
  const block = createBlock({ name: 'Paddock 1', fieldId: pasture.id, acres: 1 });
  const otherBlock = createBlock({ name: 'Paddock 2', fieldId: other.id, acres: 1 });
  const sprayerId = `sprayer-${randomUUID()}`;
  db.insert(equipment)
    .values(tenantValues({ id: sprayerId, type: 'sprayer' as const, label: 'Backpack' }))
    .run();
  const group = insertAnimalGroup({
    name: 'Layers',
    speciesId: 'chicken',
    purpose: 'production',
    headCount: 6,
    foodProducing: true,
    housingFieldId: barnId
  });
  insertStay({
    subject: { subjectType: 'group', subjectId: group.id },
    fieldId: barnId,
    atMs: sinceMs,
    movedBy: null
  });
  const hen = insertAnimal({
    speciesId: 'chicken',
    groupId: group.id,
    name: 'Henrietta',
    purpose: 'production',
    foodProducing: true,
    housingFieldId: barnId
  });
  return {
    barnId,
    pastureId: pasture.id,
    otherPastureId: other.id,
    blockId: block.id,
    otherBlockId: otherBlock.id,
    sprayerId,
    groupId: group.id,
    henId: hen.id
  };
}

export function spray(
  farm: Farm,
  atMs: number,
  pluginId = KNOWN_HERBICIDE.pluginId,
  blockId?: string
) {
  return insertSprayEvent({
    blockId: blockId ?? farm.blockId,
    sprayerId: farm.sprayerId,
    performedById: TEST_USER,
    occurredAt: atMs,
    products: [{ pluginId, chemistryClasses: ['synthetic-auxin'] }],
    conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
    rulesVersion: 'test',
    pluginHashes: {}
  });
}
