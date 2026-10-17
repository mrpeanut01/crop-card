// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { insertCropHarvestEvent } from '$lib/db/harvestEvents';
import { insertHarvestDisposition } from '$lib/db/harvestDispositions';
import { setSetting } from '$lib/db/settings';
import { loadKeptTotals, seasonYear } from '$lib/server/pantry.server';
import { pantrySnapshotPart } from '$lib/server/pantrySnapshot';
import { buildFarmSnapshot } from '$lib/server/cardSnapshot';
import { buildPlantingCard } from '$lib/cards/build/planting';
import { BRIEF_SETTING_KEY } from '$lib/garden/briefGoals';
import type { HarvestScheduleResponse } from '$lib/garden/harvestScheduleApi';
import { GET } from './+server';
import { load as pantryLoad } from '../../../plan/pantry/+page.server';

type Handler = (event: never) => Response | Promise<Response>;

for (const id of ['hs-owner', 'hs-helper', 'hs-inspector']) {
  db.insert(users)
    .values({ id, email: `${id}@test.local` })
    .onConflictDoNothing()
    .run();
}

interface Farm {
  ownerId: string;
  fieldId: string;
  blockId: string;
  plantingId: string;
}

function seedFarm(label: string, opts: { brief?: unknown; herb?: string } = {}): Farm {
  const ownerId = `hs-${label}-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  return runWithTenant(ownerId, () => {
    const field = createField({ name: `${label} herbs`, kind: 'garden' });
    const block = createBlock({ name: `${label} bed`, fieldId: field.id, acres: 0.01 });
    const year = seasonYear();
    const crop = createPlanned({
      blockId: block.id,
      cropPluginId: opts.herb ?? 'basil-genovese',
      varietyDisplayName: 'Genovese Basil',
      plantingDate: Date.UTC(year, 4, 1)
    });
    if (opts.brief !== undefined) setSetting(BRIEF_SETTING_KEY, JSON.stringify(opts.brief));
    return { ownerId, fieldId: field.id, blockId: block.id, plantingId: crop.id };
  });
}

function event(farm: Farm, role: 'owner' | 'helper' | 'inspector' | null, query = '') {
  const url = new URL(`http://localhost/api/garden/harvest-schedule${query}`);
  return {
    url,
    params: {},
    request: new Request(url.href),
    locals: {
      authVia: 'cookie',
      user: role
        ? {
            id: `hs-${role}`,
            email: null,
            phone: null,
            role,
            activeOwnerId: farm.ownerId,
            isSuperadmin: false,
            impersonating: false
          }
        : undefined
    },
    cookies: { get: () => undefined }
  } as never;
}

async function get(farm: Farm, role: 'owner' | 'helper' | 'inspector' | null, query = '') {
  return runWithTenantAsync(farm.ownerId, async () => {
    const res = await (GET as Handler)(event(farm, role, query));
    return { status: res.status, body: (await res.json()) as HarvestScheduleResponse };
  });
}

const BRIEF = { storageGoals: [{ goal: 'dry', target: 'oregano for the year' }, 'can-or-jelly'] };

describe('GET /api/garden/harvest-schedule', () => {
  it('gives every role the herb schedule and the brief goals as not known', async () => {
    const farm = seedFarm('basic', { brief: BRIEF });
    for (const role of ['owner', 'helper', 'inspector'] as const) {
      const { status, body } = await get(farm, role);
      expect(status).toBe(200);
      expect(body.plantings).toHaveLength(1);
      expect(body.plantings[0]).toMatchObject({
        plantingId: farm.plantingId,
        cropPluginId: 'basil-genovese',
        endsAt: 'first-fall-frost'
      });
      expect(body.weeks.length).toBeGreaterThan(0);
      expect(body.goals.map((g) => [g.goal, g.status, g.reason])).toEqual([
        ['dry', 'not-known', 'no-data'],
        ['can-or-jelly', 'not-known', 'needs-recipe']
      ]);
      expect(body.goals[0].target).toBe('oregano for the year');
    }
  });

  it('refuses a signed-out request and an Area of another farm', async () => {
    const a = seedFarm('area-a');
    const b = seedFarm('area-b');
    expect((await get(a, null)).status).toBe(401);
    expect((await get(a, 'owner', `?areaId=${b.fieldId}`)).status).toBe(404);
    const own = await get(a, 'owner', `?areaId=${a.fieldId}`);
    expect(own.body.plantings.map((p) => p.plantingId)).toEqual([a.plantingId]);
  });

  it('never shows another farm', async () => {
    const a = seedFarm('iso-a', { brief: BRIEF });
    const b = seedFarm('iso-b');
    const out = await get(b, 'owner');
    expect(out.body.plantings.map((p) => p.plantingId)).toEqual([b.plantingId]);
    expect(out.body.goals).toEqual([]);
    expect(JSON.stringify(out.body)).not.toContain(a.plantingId);
  });

  it('a non-herb planting stays out of the farm-wide view', async () => {
    const farm = seedFarm('tomato', { herb: 'tomato-amish-paste' });
    expect((await get(farm, 'owner')).body.plantings).toEqual([]);
    const area = await get(farm, 'owner', `?areaId=${farm.fieldId}`);
    expect(area.body.plantings).toHaveLength(1);
  });
});

describe('pantry kept totals, page and snapshot', () => {
  function keep(farm: Farm, rows: Array<{ quantity: number; unit: string; preservedAs?: 'dry' }>) {
    runWithTenant(farm.ownerId, () => {
      const harvest = insertCropHarvestEvent({
        blockId: farm.blockId,
        cropId: farm.plantingId,
        cropPluginId: 'basil-genovese',
        occurredAt: Date.now() - 3_600_000,
        quantity: '5 bunch'
      });
      for (const r of rows) {
        insertHarvestDisposition({
          harvestEventId: harvest.id,
          kind: 'kept',
          quantity: r.quantity,
          unit: r.unit,
          occurredAt: Date.now() - 1_800_000,
          recipient: null,
          soldAsOrganic: null,
          preservedAs: r.preservedAs ?? null
        });
      }
    });
  }

  it('sums kept rows by crop, method and unit, tenant-scoped', () => {
    const a = seedFarm('kept-a');
    const b = seedFarm('kept-b');
    keep(a, [
      { quantity: 2, unit: 'bunch', preservedAs: 'dry' },
      { quantity: 1.5, unit: 'Bunch', preservedAs: 'dry' },
      { quantity: 1, unit: 'bunch' }
    ]);
    const totals = runWithTenant(a.ownerId, () => loadKeptTotals(seasonYear()));
    expect(totals).toEqual([
      { cropPluginId: 'basil-genovese', method: 'dry', unit: 'bunch', quantity: 3.5 },
      { cropPluginId: 'basil-genovese', method: null, unit: 'bunch', quantity: 1 }
    ]);
    expect(runWithTenant(b.ownerId, () => loadKeptTotals(seasonYear()))).toEqual([]);
  });

  it('the pantry page lists kept harvests and says who may schedule', async () => {
    const farm = seedFarm('page', { brief: BRIEF });
    keep(farm, [{ quantity: 2, unit: 'bunch', preservedAs: 'dry' }]);
    for (const [role, canWrite] of [
      ['owner', true],
      ['helper', true],
      ['inspector', false]
    ] as const) {
      const data = (await runWithTenantAsync(farm.ownerId, () =>
        pantryLoad(event(farm, role) as never)
      )) as {
        kept: Array<{ cropName: string; method: string }>;
        canWrite: boolean;
        hasBrief: boolean;
      };
      expect(data.canWrite).toBe(canWrite);
      expect(data.hasBrief).toBe(true);
      expect(data.kept[0]).toMatchObject({ method: 'dry', cropName: 'Basil — Genovese' });
    }
  });

  it('the snapshot carries the goal lines and the offline Planting card shows them', async () => {
    const farm = seedFarm('snap', { brief: BRIEF });
    const part = await runWithTenantAsync(farm.ownerId, () => pantrySnapshotPart(Date.now()));
    expect(part.pantry?.goals.map((g) => g.status)).toEqual(['not-known', 'not-known']);
    const snapshot = await runWithTenantAsync(farm.ownerId, () => buildFarmSnapshot());
    expect(snapshot.pantry?.year).toBe(seasonYear());
    const card = buildPlantingCard(snapshot, farm.plantingId);
    const section = card?.sections.find((s) => s.title === 'Harvest goals');
    expect(section?.items[0]).toBe(
      'Drying: Not known. No preserving guidance yet for what you planted. Your aim: oregano for the year'
    );
    expect(section?.provenance).toBe('fallback');
    const empty = seedFarm('snap-empty', { herb: 'tomato-amish-paste' });
    const none = await runWithTenantAsync(empty.ownerId, () => pantrySnapshotPart(Date.now()));
    expect(none).toEqual({});
  });
});
