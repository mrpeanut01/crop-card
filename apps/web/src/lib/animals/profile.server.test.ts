// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { setSetting } from '$lib/db/settings';
import { insertAnimal } from '$lib/db/animals';
import { insertAnimalGroup } from '$lib/db/animalGroups';
import { animalsNavLabel, farmHasAnimals, loadAnimalsProfile } from './profile.server';

function seedOwner(): string {
  const id = `animals-profile-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

describe('animals profile (server)', () => {
  it('hides the nav for a crop-only farm and shows it once an animal exists', () => {
    runWithTenant(seedOwner(), () => {
      expect(animalsNavLabel()).toBeNull();
      expect(farmHasAnimals()).toBe(false);
      insertAnimalGroup({
        name: 'Ewes',
        speciesId: 'sheep',
        purpose: 'production',
        headCount: 12,
        foodProducing: true
      });
      expect(farmHasAnimals()).toBe(true);
      expect(animalsNavLabel()).toBe('Animals');
    });
  });

  it('labels a garden household "Pets & animals" and reads the onboarding answer', () => {
    runWithTenant(seedOwner(), () => {
      setSetting('farm_profile', 'garden');
      expect(loadAnimalsProfile()).toMatchObject({ layout: 'pets', title: 'Pets & animals' });
      expect(animalsNavLabel()).toBeNull();
      setSetting('farm_animals', 'pets,chickens');
      expect(animalsNavLabel()).toBe('Pets & animals');
    });
    runWithTenant(seedOwner(), () => {
      setSetting('farm_profile', 'farm');
      setSetting('farm_animals', 'animals,pets');
      expect(loadAnimalsProfile().layout).toBe('farm');
    });
  });

  it("never sees another Owner's animals", () => {
    const a = seedOwner();
    const b = seedOwner();
    runWithTenant(a, () => {
      insertAnimal({
        speciesId: 'dog',
        name: 'Biscuit',
        purpose: 'pet',
        foodProducing: false
      });
    });
    runWithTenant(b, () => expect(farmHasAnimals()).toBe(false));
    runWithTenant(a, () => expect(farmHasAnimals()).toBe(true));
  });
});
