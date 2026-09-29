// @vitest-environment node
/** Phase 32D acceptance: /inventory chip visibility follows stock and
 *  animal presence, per Owner. */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenantAsync } from '$lib/db/tenant';
import { createStockItem } from '$lib/db/stock';
import { insertAnimalGroup } from '$lib/db/animalGroups';
import { load } from './+page.server';

function seedOwner(): string {
  const id = `chips-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

async function visible(type?: string): Promise<string[]> {
  const url = new URL(`http://localhost/inventory${type ? `?type=${type}` : ''}`);
  const out = (await load({ url, locals: { user: { role: 'owner' } } } as never)) as {
    visibleTypes: string[];
  };
  return out.visibleTypes;
}

const CROP_ONLY = ['pesticide', 'fertility', 'seed', 'crop'];

describe('/inventory chip visibility', () => {
  it('a crop-only farm keeps its four chips', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      expect(await visible()).toEqual(CROP_ONLY);
    });
  });

  it('feed stock shows the feed chip only', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      createStockItem({ category: 'bedding', displayName: 'Straw', defaultUnit: 'lb' });
      expect(await visible()).toEqual([...CROP_ONLY, 'feed']);
    });
  });

  it('any animal shows both animal chips, and one farm never sees another', async () => {
    const withAnimals = seedOwner();
    await runWithTenantAsync(withAnimals, async () => {
      insertAnimalGroup({
        name: 'Layers',
        speciesId: 'chicken',
        purpose: 'production',
        headCount: 6,
        foodProducing: true
      });
      expect(await visible()).toEqual([...CROP_ONLY, 'feed', 'animal-health']);
    });
    await runWithTenantAsync(seedOwner(), async () => {
      expect(await visible()).toEqual(CROP_ONLY);
    });
  });

  it('asking for an empty animal type still shows its chip', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      expect(await visible('animal-health')).toEqual([...CROP_ONLY, 'animal-health']);
    });
  });
});
