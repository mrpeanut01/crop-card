// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { crops, owners } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { addPlanting, createBlock } from '$lib/db/blocks';
import { plantsInGroundByArea } from '$lib/db/areaPlants';
import { insertAnimalGroup } from '$lib/db/animalGroups';
import { loadToxicPlants } from './toxicPlants';
import { attachToxicPlants, loadAreaHousing } from './areaHousing';
import { withHousing } from '$lib/farm/housedAnimals';
import { getBaseRegistry } from './registry';
import type { CardModel } from '$lib/cards/model';
import type { CropPlugin } from '$lib/plugins/schemas';

const DAY = 86_400_000;

function seedOwner(): string {
  const id = `toxic-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function setStatus(id: string, status: 'harvested' | 'failed' | 'archived') {
  db.update(crops)
    .set({ status })
    .where(withTenant(crops, eq(crops.id, id)))
    .run();
}

describe('plantsInGroundByArea', () => {
  it('counts active, dated plans that have come and recent harvests only', () => {
    runWithTenant(seedOwner(), () => {
      const now = Date.now();
      const area = createField({ name: 'Garden', kind: 'garden' });
      const block = createBlock({ name: 'Bed 1', fieldId: area.id });
      const plant = (id: string, date: number | null, status: 'planned' | 'active') =>
        addPlanting({
          blockId: block.id,
          cropPluginId: id,
          varietyDisplayName: id,
          plantingDate: date,
          status
        });
      plant('active-crop', now - 10 * DAY, 'active');
      plant('planned-past', now - DAY, 'planned');
      plant('planned-future', now + 10 * DAY, 'planned');
      plant('planned-undated', null, 'planned');
      setStatus(plant('harvested-recent', now - 30 * DAY, 'active').id, 'harvested');
      setStatus(plant('harvested-old', now - 3 * 365 * DAY, 'active').id, 'harvested');
      setStatus(plant('failed', now - 5 * DAY, 'active').id, 'failed');
      const ids = plantsInGroundByArea(now)
        .map((p) => p.cropPluginId)
        .sort();
      expect(ids).toEqual(['active-crop', 'harvested-recent', 'planned-past']);
      expect(plantsInGroundByArea(now).every((p) => p.areaId === area.id)).toBe(true);
    });
  });

  it('never returns another Owner’s plantings', () => {
    const a = seedOwner();
    const b = seedOwner();
    runWithTenant(a, () => {
      const area = createField({ name: 'A pasture', kind: 'pasture' });
      const block = createBlock({ name: 'A1', fieldId: area.id });
      addPlanting({
        blockId: block.id,
        cropPluginId: 'tomato-roma-vf',
        varietyDisplayName: 'Roma',
        plantingDate: Date.now() - DAY,
        status: 'active'
      });
    });
    runWithTenant(b, () => {
      expect(plantsInGroundByArea()).toEqual([]);
    });
  });
});

describe('loadToxicPlants', () => {
  it('reads sourced toxicity from the shipped library for crops in the ground', async () => {
    const base = await getBaseRegistry();
    const roma = base.get('tomato-roma-vf')?.plugin as CropPlugin;
    expect(roma.animalToxicity?.length).toBeGreaterThan(0);
    await runWithTenantAsync(seedOwner(), async () => {
      const area = createField({ name: 'Dog run', kind: 'garden' });
      const block = createBlock({ name: 'Run bed', fieldId: area.id });
      for (const id of ['tomato-roma-vf', 'lettuce-buttercrunch']) {
        addPlanting({
          blockId: block.id,
          cropPluginId: id,
          varietyDisplayName: id,
          plantingDate: Date.now() - DAY,
          status: 'active'
        });
      }
      const { toxicPlants, speciesPlural } = await loadToxicPlants();
      expect(Object.keys(toxicPlants)).toEqual([area.id]);
      expect(toxicPlants[area.id].map((c) => c.pluginId)).toEqual(['tomato-roma-vf']);
      expect(toxicPlants[area.id][0].toxicity).toEqual(roma.animalToxicity);
      expect(speciesPlural.dog).toBe('Dogs');
    });
  });
});

describe('Area Card callout through housing', () => {
  it('shows on a housed Area whose crops can harm its animals', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const area = createField({ name: 'Goat lot', kind: 'pasture' });
      const block = createBlock({ name: 'Lot', fieldId: area.id });
      addPlanting({
        blockId: block.id,
        cropPluginId: 'bmr-sorghum-sudan',
        varietyDisplayName: 'BMR',
        plantingDate: Date.now() - DAY,
        status: 'active'
      });
      insertAnimalGroup({
        name: 'Herd A',
        speciesId: 'goat',
        purpose: 'production',
        headCount: 4,
        foodProducing: true,
        housingFieldId: area.id
      });
      const { housing } = await loadAreaHousing([{ id: area.id, kind: 'pasture' }]);
      const card: CardModel = {
        kind: 'area',
        key: 'ar_x',
        kicker: 'Area',
        title: 'Goat lot',
        facts: [],
        sections: [],
        asOf: 0,
        provenance: [],
        href: '/plan'
      };
      const out = withHousing(card, housing[area.id]);
      const toxic = out.sections.find((s) => s.collapsible);
      expect(toxic?.title).toBe('1 plant here can harm goats');
      expect(toxic?.provenance).toBe('plugin');
      expect(out.sections.map((s) => s.title)[0]).toBe('Lives here');
    });
  });

  it('attaches nothing to an Area without toxic crops or animals', () => {
    const housing = {
      a: { groups: [], animals: [], total: 2, capacity: null, speciesIds: ['dog'] },
      b: { groups: [], animals: [], total: 0, capacity: null }
    };
    attachToxicPlants(housing, { b: [] }, { dog: 'Dogs' });
    expect(housing.a).not.toHaveProperty('toxicPlants');
    expect(housing.b).not.toHaveProperty('toxicPlants');
  });
});
