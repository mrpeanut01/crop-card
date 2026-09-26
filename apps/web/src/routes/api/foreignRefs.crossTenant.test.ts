/**
 * Invariant 6 — mutation endpoints must not store another Owner's ids.
 *
 * Real-DB, two-Owner sweep: Owner A calls each endpoint with an id that
 * belongs to Owner B (the row exists, so SQLite FKs are satisfied). Every
 * call must answer 400 `unknown <field>` and write nothing. Own-id controls
 * prove the check doesn't reject legitimate references. Bearer and
 * offline-queue drains hit these same handlers, so this covers them too.
 */

import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import * as blocksRepo from '$lib/db/blocks';
import * as cropsRepo from '$lib/db/crops';
import * as cropEquipmentRepo from '$lib/db/cropEquipment';
import * as equipmentRepo from '$lib/db/equipment';
import * as fieldsRepo from '$lib/db/fields';
import * as scoutRepo from '$lib/db/scoutObservations';
import * as shadeRepo from '$lib/db/shadeSources';
import * as stockRepo from '$lib/db/stock';
import * as tasksRepo from '$lib/db/tasks';
import * as taxonomyRepo from '$lib/db/taxonomy';

const USER_ID = 'foreign-refs-test-user';

vi.mock('$lib/server/auth', () => {
  const user = { id: 'foreign-refs-test-user', email: 'fr@test', role: 'owner' as const };
  return { currentUser: () => user, requireUser: () => user, requireOwner: () => user };
});

import { POST as sprayPost } from './spray/record/+server';
import { POST as insecticidePost } from './insecticide/record/+server';
import { POST as fungicidePost } from './fungicide/record/+server';
import { POST as harvestPost } from './harvest/record/+server';
import { POST as hayPost } from './hay/cuttings/+server';
import { POST as scoutPost } from './scout/record/+server';
import { POST as fertAppPost } from './fertility/applications/+server';
import { POST as fertCreditPost } from './fertility/credits/+server';
import { POST as soilTestPost } from './fertility/soil-tests/+server';
import { POST as blocksPost } from './blocks/+server';
import { POST as shadePost } from './shade-sources/+server';
import { PATCH as shadePatch } from './shade-sources/[id]/+server';
import { PATCH as cropPatch } from './crops/[id]/+server';
import { POST as cropEquipmentPost } from './crops/[id]/equipment/+server';
import { POST as inputsCommitPost } from './plan/inputs/commit/+server';
import { POST as equipmentPost } from './equipment/+server';
import { POST as stockPost } from './stock/+server';
import { PATCH as stockPatch } from './stock/[id]/+server';
import { PATCH as typePatch } from './types/[id]/+server';
import { POST as gardenFillPost } from './garden/beds/[blockId]/fill/+server';

const OWNER_A = 'foreign-refs-owner-a';
const OWNER_B = 'foreign-refs-owner-b';

interface Fixture {
  fieldId: string;
  blockId: string;
  cropId: string;
  equipmentId: string;
  stockItemId: string;
  typeId: string;
  shadeId: string;
}

function seed(ownerId: string): Fixture {
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .onConflictDoNothing()
    .run();
  return runWithTenant(ownerId, () => {
    const field = fieldsRepo.createField({ name: `${ownerId}-field` });
    const block = blocksRepo.createBlock({ name: `${ownerId}-block`, fieldId: field.id, acres: 1 });
    const crop = cropsRepo.createPlanned({
      blockId: block.id,
      cropPluginId: 'crop:tomato',
      varietyDisplayName: 'Roma'
    });
    const equipment = equipmentRepo.createEquipment({ type: 'planter', label: `${ownerId}-rig` });
    const stock = stockRepo.createStockItem({
      category: 'fertilizer',
      displayName: `${ownerId}-urea`,
      defaultUnit: 'lb'
    });
    const term = taxonomyRepo.createTaxonomyTerm({
      domain: 'equipment',
      name: `${ownerId}-type-${randomUUID()}`
    });
    const shade = shadeRepo.createShadeSource({
      name: `${ownerId}-oak`,
      heightFt: 40,
      fieldId: field.id
    });
    return {
      fieldId: field.id,
      blockId: block.id,
      cropId: crop.id,
      equipmentId: equipment.id,
      stockItemId: stock.id,
      typeId: term.id,
      shadeId: shade.id
    };
  });
}

let A: Fixture;
let B: Fixture;

beforeAll(() => {
  db.insert(users).values({ id: USER_ID, email: 'fr@test' }).onConflictDoNothing().run();
  A = seed(OWNER_A);
  B = seed(OWNER_B);
});

type Handler = (event: never) => Promise<Response> | Response;

function call(
  handler: Handler,
  body: unknown,
  params: Record<string, string> = {}
): Promise<Response> {
  const url = new URL('http://localhost/api/test');
  const event = {
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    params,
    url,
    locals: {},
    cookies: { get: () => undefined }
  };
  return runWithTenantAsync(OWNER_A, async () => handler(event as never));
}

const conditions = { windMph: 3, tempF: 70, rainForecastMmNext24h: 0 };

function sprayBody(over: Record<string, unknown>) {
  return {
    blockId: A.blockId,
    blockCrops: { primary: { cropPluginId: 'crop:tomato' } },
    productPluginIds: ['herbicide:none'],
    sprayer: { id: 'none' },
    conditions,
    ...over
  };
}

function inputsApp(blockId: string) {
  return {
    id: 'app-1',
    plantingId: 'p-1',
    blockId,
    cropPluginId: 'crop:tomato',
    slot: 'pre-plant',
    productPluginId: null,
    productDisplayName: null,
    productCategory: 'fertilizer',
    applicationDateMs: Date.now(),
    rateAmount: null,
    rateUnit: null,
    acres: 1,
    totalAmount: null,
    rationale: 'test'
  };
}

type Case = [name: string, field: string, run: () => Promise<Response>, unchanged?: () => unknown];

const cases: Case[] = [
  ['spray/record blockId', 'blockId', () => call(sprayPost, sprayBody({ blockId: B.blockId }))],
  ['spray/record cropId', 'cropId', () => call(sprayPost, sprayBody({ cropId: B.cropId }))],
  [
    'insecticide/record blockId',
    'blockId',
    () =>
      call(insecticidePost, {
        blockId: B.blockId,
        productPluginIds: ['insecticide:none'],
        conditions
      })
  ],
  [
    'insecticide/record cropId',
    'cropId',
    () =>
      call(insecticidePost, {
        blockId: A.blockId,
        cropId: B.cropId,
        productPluginIds: ['insecticide:none'],
        conditions
      })
  ],
  [
    'fungicide/record blockId',
    'blockId',
    () =>
      call(fungicidePost, {
        blockId: B.blockId,
        productPluginIds: ['fungicide:none'],
        conditions
      })
  ],
  [
    'fungicide/record cropId',
    'cropId',
    () =>
      call(fungicidePost, {
        blockId: A.blockId,
        cropId: B.cropId,
        productPluginIds: ['fungicide:none'],
        conditions
      })
  ],
  [
    'harvest/record cropId',
    'cropId',
    () => call(harvestPost, { blockId: A.blockId, cropId: B.cropId, cropPluginId: 'crop:tomato' })
  ],
  [
    'hay/cuttings blockId',
    'blockId',
    () => call(hayPost, { blockId: B.blockId, cropPluginId: 'crop:alfalfa' })
  ],
  [
    'hay/cuttings cropId',
    'cropId',
    () => call(hayPost, { blockId: A.blockId, cropId: B.cropId, cropPluginId: 'crop:alfalfa' })
  ],
  [
    'scout/record blockId',
    'blockId',
    () => call(scoutPost, { blockId: B.blockId, pest: 'aphid', metric: 'count', value: 1 }),
    () => runWithTenant(OWNER_A, () => scoutRepo.listScoutObservations({}).length)
  ],
  [
    'scout/record cropId',
    'cropId',
    () =>
      call(scoutPost, {
        blockId: A.blockId,
        cropId: B.cropId,
        pest: 'aphid',
        metric: 'count',
        value: 1
      })
  ],
  [
    'fertility/applications blockId',
    'blockId',
    () => call(fertAppPost, { blockId: B.blockId, source: 'urea', ratePerAcre: 1, rateUnit: 'lb' })
  ],
  [
    'fertility/applications cropId',
    'cropId',
    () =>
      call(fertAppPost, {
        blockId: A.blockId,
        cropId: B.cropId,
        source: 'urea',
        ratePerAcre: 1,
        rateUnit: 'lb'
      })
  ],
  [
    'fertility/applications stockItemId',
    'stockItemId',
    () =>
      call(fertAppPost, {
        blockId: A.blockId,
        stockItemId: B.stockItemId,
        source: 'urea',
        ratePerAcre: 1,
        rateUnit: 'lb'
      })
  ],
  [
    'fertility/credits blockId',
    'blockId',
    () => call(fertCreditPost, { blockId: B.blockId, appliesToYear: 2026, source: 'vetch' })
  ],
  [
    'fertility/soil-tests blockId',
    'blockId',
    () => call(soilTestPost, { blockId: B.blockId, ph: 6.5 })
  ],
  [
    'blocks POST fieldId',
    'fieldId',
    () => call(blocksPost, { name: 'sneaky', fieldId: B.fieldId }),
    () => runWithTenant(OWNER_A, () => blocksRepo.listBlocks().length)
  ],
  [
    'shade-sources POST fieldId',
    'fieldId',
    () => call(shadePost, { name: 'sneaky', heightFt: 10, fieldId: B.fieldId }),
    () => runWithTenant(OWNER_A, () => shadeRepo.listShadeSources().length)
  ],
  [
    'shade-sources PATCH fieldId',
    'fieldId',
    () => call(shadePatch, { fieldId: B.fieldId }, { id: A.shadeId }),
    () => runWithTenant(OWNER_A, () => shadeRepo.getShadeSource(A.shadeId)?.fieldId)
  ],
  [
    'crops/[id] set-schedule blockId',
    'blockId',
    () =>
      call(
        cropPatch,
        { action: 'set-schedule', plantingDate: Date.now(), blockId: B.blockId },
        { id: A.cropId }
      ),
    () => runWithTenant(OWNER_A, () => cropsRepo.getCrop(A.cropId)?.blockId)
  ],
  [
    'crops/[id] set-placement blockId',
    'blockId',
    () =>
      call(
        cropPatch,
        {
          action: 'set-placement',
          blockId: B.blockId,
          footprint: { x_in: 0, y_in: 0, w_in: 12, l_in: 12 },
          spacingPattern: 'square'
        },
        { id: A.cropId }
      ),
    () => runWithTenant(OWNER_A, () => cropsRepo.getCrop(A.cropId))
  ],
  [
    'garden/beds/[blockId]/fill blockId',
    'blockId',
    () => call(gardenFillPost, { dateMs: Date.now(), seasonYear: 2027 }, { blockId: B.blockId })
  ],
  [
    'crops/[id]/equipment equipmentId',
    'equipmentId',
    () =>
      call(cropEquipmentPost, { equipmentId: B.equipmentId, role: 'planter' }, { id: A.cropId }),
    () => runWithTenant(OWNER_A, () => cropEquipmentRepo.listCropEquipment(A.cropId).length)
  ],
  [
    'plan/inputs/commit blockId',
    'blockId',
    () => call(inputsCommitPost, { applications: [inputsApp(B.blockId)] }),
    () => runWithTenant(OWNER_A, () => tasksRepo.listTasks().length)
  ],
  [
    'equipment POST typeId',
    'typeId',
    () => call(equipmentPost, { type: 'planter', label: 'sneaky', typeId: B.typeId }),
    () => runWithTenant(OWNER_A, () => equipmentRepo.listEquipment().length)
  ],
  [
    'stock POST typeId',
    'typeId',
    () =>
      call(stockPost, {
        category: 'fertilizer',
        displayName: 'sneaky',
        defaultUnit: 'lb',
        typeId: B.typeId
      }),
    () => runWithTenant(OWNER_A, () => stockRepo.listStockItems().length)
  ],
  [
    'stock PATCH typeId',
    'typeId',
    () => call(stockPatch, { typeId: B.typeId }, { id: A.stockItemId }),
    () => runWithTenant(OWNER_A, () => stockRepo.getStockItem(A.stockItemId)?.typeId)
  ]
];

describe('mutation endpoints reject another Owner’s ids (Invariant 6)', () => {
  it.each(cases)('%s → 400 unknown %s, nothing written', async (_n, field, run, unchanged) => {
    const before = unchanged?.();
    const res = await run();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: `unknown ${field}` });
    if (unchanged) expect(unchanged()).toEqual(before);
  });

  it('no foreign spray / scout row reached the DB for Owner B’s block', () => {
    const bScouts = runWithTenant(OWNER_B, () => scoutRepo.listScoutObservations({}));
    expect(bScouts).toHaveLength(0);
  });
});

describe('own-Owner references still pass', () => {
  it('scout/record with own block + crop → 201', async () => {
    const res = await call(scoutPost, {
      blockId: A.blockId,
      cropId: A.cropId,
      pest: 'aphid',
      metric: 'count',
      value: 2
    });
    expect(res.status).toBe(201);
  });

  it('blocks POST with own field → 201', async () => {
    const res = await call(blocksPost, { name: `own-${randomUUID()}`, fieldId: A.fieldId });
    expect(res.status).toBe(201);
  });

  it('crops/[id]/equipment with own equipment → 201 and label renders', async () => {
    const res = await call(
      cropEquipmentPost,
      { equipmentId: A.equipmentId, role: 'planter' },
      { id: A.cropId }
    );
    expect(res.status).toBe(201);
    const { binding } = await res.json();
    expect(binding.equipmentLabel).toBe(`${OWNER_A}-rig`);
  });

  it('stock POST with a shared default type → 201', async () => {
    const def = runWithTenant(OWNER_A, () =>
      taxonomyRepo.listTaxonomyTerms().find((t) => t.isDefault)
    );
    const res = await call(stockPost, {
      category: 'fertilizer',
      displayName: `own-${randomUUID()}`,
      defaultUnit: 'lb',
      typeId: def!.id
    });
    expect(res.status).toBe(201);
  });

  it('fertility/soil-tests with own block → 201', async () => {
    const res = await call(soilTestPost, { blockId: A.blockId, ph: 6.4 });
    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/types/:id', () => {
  it('refuses to rename a shared default (would rename it for every farm)', async () => {
    const def = runWithTenant(OWNER_A, () =>
      taxonomyRepo.listTaxonomyTerms({ domain: 'equipment' }).find((t) => t.isDefault)
    )!;
    const res = await call(typePatch, { name: 'hijacked' }, { id: def.id });
    expect(res.status).toBe(400);
    expect(runWithTenant(OWNER_B, () => taxonomyRepo.getTaxonomyTerm(def.id)?.name)).toBe(def.name);
  });

  it("404s on another Owner's term", async () => {
    const res = await call(typePatch, { name: 'x' }, { id: B.typeId });
    expect(res.status).toBe(404);
  });
});
