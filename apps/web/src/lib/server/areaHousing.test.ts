// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/registry')>();
  const species: Record<string, object> = {
    chicken: { pluginId: 'chicken', displayName: 'Chicken', tile: { label: 'Chickens' } },
    sheep: { pluginId: 'sheep', displayName: 'Sheep', tile: { label: 'Sheep' } },
    dog: { pluginId: 'dog', displayName: 'Dog', tile: { label: 'Dogs' } }
  };
  return {
    ...actual,
    getDataKinds: async () => ({
      species: { get: (id: string) => species[id], all: () => Object.values(species) }
    })
  };
});

import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenantAsync } from '$lib/db/tenant';
import { createField, listFields } from '$lib/db/fields';
import { insertAnimal, setAnimalStatus } from '$lib/db/animals';
import { insertAnimalGroup } from '$lib/db/animalGroups';
import { setFarmAnimals, setFarmProfile } from '$lib/onboarding/state.server';
import { loadAreaHousing } from './areaHousing';

function seedOwner(): string {
  const id = `housing-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

describe('loadAreaHousing', () => {
  it('lists who lives on each Area with shared group totals and coop capacity', async () => {
    const owner = seedOwner();
    await runWithTenantAsync(owner, async () => {
      const coop = createField({ name: 'Hen House', kind: 'coop_pen', details: { capacity: 24 } });
      const pasture = createField({ name: 'North Pasture', kind: 'pasture' });
      const house = createField({ name: 'House', kind: 'residence' });
      const flock = insertAnimalGroup({
        name: 'Layers',
        speciesId: 'chicken',
        purpose: 'production',
        headCount: 24,
        foodProducing: true,
        housingFieldId: coop.id
      });
      insertAnimal({
        speciesId: 'chicken',
        groupId: flock.id,
        name: 'Henny',
        purpose: 'production',
        foodProducing: true,
        housingFieldId: coop.id
      });
      const ewes = insertAnimalGroup({
        name: 'Ewes',
        speciesId: 'sheep',
        purpose: 'production',
        headCount: 12,
        foodProducing: true,
        housingFieldId: pasture.id
      });
      insertAnimal({
        speciesId: 'sheep',
        name: 'Ram',
        tag: '1',
        purpose: 'production',
        foodProducing: true,
        housingFieldId: pasture.id
      });
      insertAnimal({
        speciesId: 'dog',
        name: 'Rex',
        purpose: 'pet',
        foodProducing: false,
        housingFieldId: house.id
      });
      const sold = insertAnimal({
        speciesId: 'sheep',
        name: 'Gone',
        purpose: 'production',
        foodProducing: true,
        housingFieldId: pasture.id
      });
      setAnimalStatus(sold.id, 'sold', Date.now(), null);

      const { housing, petsLayout } = await loadAreaHousing(listFields());
      expect(petsLayout).toBe(false);

      expect(housing[coop.id].total).toBe(25);
      expect(housing[coop.id].groups).toEqual([
        {
          id: flock.id,
          name: 'Layers',
          speciesPlural: 'Chickens',
          total: 25,
          foodProducing: true
        }
      ]);
      expect(housing[coop.id].animals).toEqual([]);
      expect(housing[coop.id].capacity).toEqual({ capacity: 24, count: 25, over: true });

      expect(housing[pasture.id].groups.map((g) => g.id)).toEqual([ewes.id]);
      expect(housing[pasture.id].animals.map((a) => a.name)).toEqual(['Ram']);
      expect(housing[pasture.id].total).toBe(13);
      expect(housing[pasture.id].capacity).toBeNull();
      expect(housing[coop.id].speciesIds).toEqual(['chicken']);
      expect(housing[house.id].speciesIds).toEqual(['dog']);

      expect(housing[house.id].animals).toEqual([
        expect.objectContaining({ name: 'Rex', speciesName: 'Dog', foodProducing: false })
      ]);
    });
  });

  it('follows the pets layout rule and shows capacity on an empty coop', async () => {
    const owner = seedOwner();
    await runWithTenantAsync(owner, async () => {
      const coop = createField({ name: 'Coop', kind: 'coop_pen', details: { capacity: 6 } });
      setFarmProfile('farm');
      setFarmAnimals(['pets']);
      const { housing, petsLayout } = await loadAreaHousing(listFields());
      expect(petsLayout).toBe(true);
      expect(housing[coop.id]).toEqual({
        groups: [],
        animals: [],
        total: 0,
        capacity: { capacity: 6, count: 0, over: false },
        capacityProvenance: 'manual'
      });
    });
  });

  it('#477 carries a kept suggestion through as data', async () => {
    const owner = seedOwner();
    await runWithTenantAsync(owner, async () => {
      const coop = createField({
        name: 'Coop',
        kind: 'coop_pen',
        details: { capacity: 11, capacityProvenance: 'data' }
      });
      const { housing } = await loadAreaHousing(listFields());
      expect(housing[coop.id].capacityProvenance).toBe('data');
    });
  });

  it('is empty for a farm with no animals and no coop', async () => {
    const owner = seedOwner();
    await runWithTenantAsync(owner, async () => {
      createField({ name: 'Home Field', kind: 'field' });
      expect(await loadAreaHousing(listFields())).toEqual({ housing: {}, petsLayout: false });
    });
  });
});
