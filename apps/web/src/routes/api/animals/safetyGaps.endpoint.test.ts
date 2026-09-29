// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({ role: 'owner' as string }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: 'gaps-user', role: m.role });
  return {
    currentUser: user,
    requireUser: user,
    requireMutator: () => {
      if (m.role === 'inspector') throw error(403, 'inspector role is read-only');
      return user();
    },
    requireOwner: () => {
      if (m.role !== 'owner') throw error(403, 'owner role required');
      return user();
    }
  };
});

vi.mock('$lib/server/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/registry')>();
  const species: Record<string, object> = {
    chicken: {
      pluginId: 'chicken',
      displayName: 'Chicken',
      foodProducingDefault: true,
      products: ['eggs', 'meat']
    },
    sheep: {
      pluginId: 'sheep',
      displayName: 'Sheep',
      foodProducingDefault: true,
      products: ['meat', 'milk', 'fiber']
    },
    dog: { pluginId: 'dog', displayName: 'Dog', foodProducingDefault: false, products: [] }
  };
  return {
    ...actual,
    getDataKinds: async () => ({
      species: { get: (id: string) => species[id] },
      animalHealth: { get: () => undefined }
    })
  };
});

import { db } from '$lib/db/client';
import { animalHealthEvents, equipment, owners, recordDeletions, users } from '$lib/db/schema';
import { runWithTenantAsync, tenantValues, withTenant } from '$lib/db/tenant';
import { createField, getField } from '$lib/db/fields';
import { createBlock, getBlock } from '$lib/db/blocks';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import { listCuttings } from '$lib/db/hayCuttings';
import { eq } from 'drizzle-orm';
import { getAnimalGroup } from '$lib/db/animalGroups';

import { POST as CREATE } from './+server';
import { POST as MOVE } from './move/+server';
import { POST as STATUS } from './status/+server';
import { POST as PRODUCTION } from './production/record/+server';
import { DELETE as UNDO_MOVE } from './locations/[id]/+server';
import { POST as CREATE_GROUP } from '../animal-groups/+server';
import { PATCH as GROUP_PATCH } from '../animal-groups/[id]/+server';
import { POST as HAY } from '../hay/cuttings/+server';
import { PATCH as HAY_STEP } from '../hay/cuttings/[id]/+server';
import { DELETE as DELETE_BLOCK } from '../blocks/[id]/+server';
import { DELETE as DELETE_FIELD } from '../fields/[id]/+server';
import { DELETE as DELETE_SPRAY } from '../spray/records/[id]/+server';
import { POST as UPLOAD } from '../plugins/upload/+server';

const DAY = 86_400_000;
const HOUR = 3_600_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function seedOwner(): string {
  const id = `gaps-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: 'gaps-user', email: 'gaps@test.local' })
    .onConflictDoNothing()
    .run();
  return id;
}

async function call(
  handler: unknown,
  path: string,
  method: string,
  opts: { params?: Record<string, string>; body?: unknown; query?: string } = {}
): Promise<{ status: number; body: Json }> {
  const url = new URL(`http://localhost/api${path}${opts.query ?? ''}`);
  try {
    const res = await (handler as (e: never) => Promise<Response>)({
      params: opts.params ?? {},
      url,
      request: new Request(url.href, {
        method,
        headers: { 'content-type': 'application/json' },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      }),
      locals: {}
    } as never);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : {} };
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (!status) throw e;
    return { status, body: {} };
  }
}

const post = (handler: unknown, path: string, body: unknown) =>
  call(handler, path, 'POST', { body });
const move = (body: unknown) => post(MOVE, '/animals/move', body);
const status = (body: unknown) => post(STATUS, '/animals/status', body);

interface Farm {
  barnId: string;
  pastureId: string;
  blockId: string;
  sprayId: string;
}

function sprayedPasture(daysAgo = 10, pluginId = 'unsourced-weedkiller'): Farm {
  const barn = createField({ name: 'Barn', kind: 'barn' });
  const pasture = createField({ name: 'North pasture', kind: 'pasture' });
  const block = createBlock({ name: 'Paddock 1', fieldId: pasture.id, acres: 1 });
  const sprayerId = `sprayer-${randomUUID()}`;
  db.insert(equipment)
    .values(tenantValues({ id: sprayerId, type: 'sprayer' as const, label: 'Backpack' }))
    .run();
  const spray = insertSprayEvent({
    blockId: block.id,
    sprayerId,
    performedById: 'gaps-user',
    occurredAt: Date.now() - daysAgo * DAY,
    products: [{ pluginId, chemistryClasses: ['synthetic-auxin'] }],
    conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
    rulesVersion: 'test',
    pluginHashes: {}
  });
  return { barnId: barn.id, pastureId: pasture.id, blockId: block.id, sprayId: spray.id };
}

async function ewes(farm: Farm, headCount = 12): Promise<string> {
  const res = await post(CREATE_GROUP, '/animal-groups', {
    name: 'Ewes',
    speciesId: 'sheep',
    headCount,
    housingFieldId: farm.barnId
  });
  expect(res.status).toBe(201);
  return res.body.group.id;
}

function treat(subjectType: 'animal' | 'group', subjectId: string, at: number) {
  db.insert(animalHealthEvents)
    .values(
      tenantValues({
        id: randomUUID(),
        subjectType,
        subjectId,
        kind: 'treatment' as const,
        productName: 'Mystery drench',
        administeredAt: new Date(at),
        foodProducingAtRecord: true
      })
    )
    .run();
}

beforeEach(() => {
  m.role = 'owner';
});

describe('a meat declaration dated before a treatment', () => {
  it('is refused for an individual, since the dose shows the animal was alive', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const made = await post(CREATE, '/animals', { speciesId: 'sheep', tag: 'Z1' });
      const id = made.body.animal.id as string;
      treat('animal', id, Date.now() - HOUR);
      const now = await status({ subjectType: 'animal', subjectId: id, status: 'slaughtered' });
      expect(now.status).toBe(422);
      m.role = 'helper';
      const back = await status({
        subjectType: 'animal',
        subjectId: id,
        status: 'slaughtered',
        occurredAt: Date.now() - 2 * DAY
      });
      expect(back.status).toBe(409);
      expect(back.body.code).toBe('OUT_OF_ORDER');
      expect(back.body.error).toContain('Mystery drench was given on');
    });
  });

  it('is refused for a group after a group treatment', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const made = await post(CREATE_GROUP, '/animal-groups', {
        name: 'Broilers',
        speciesId: 'chicken',
        headCount: 5
      });
      const groupId = made.body.group.id as string;
      treat('group', groupId, Date.now() - HOUR);
      const res = await status({
        subjectType: 'group',
        subjectId: groupId,
        status: 'slaughtered',
        headCountDelta: -5,
        occurredAt: Date.now() - 2 * DAY
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('OUT_OF_ORDER');
    });
  });
});

describe('adding animals straight onto a sprayed Area (C-29)', () => {
  it('runs the grazing gate for a new group and a new animal', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(10);
      const group = await post(CREATE_GROUP, '/animal-groups', {
        name: 'New ewes',
        speciesId: 'sheep',
        headCount: 5,
        housingFieldId: farm.pastureId
      });
      expect(group.status).toBe(422);
      expect(group.body.code).toBe('GRAZING_UNKNOWN');
      const one = await post(CREATE, '/animals', {
        speciesId: 'sheep',
        tag: 'Z',
        housingFieldId: farm.pastureId
      });
      expect(one.status).toBe(422);
      const dog = await post(CREATE, '/animals', {
        speciesId: 'dog',
        name: 'Rex',
        housingFieldId: farm.pastureId
      });
      expect(dog.status).toBe(201);
      expect(dog.body.grazingWarnings[0]).toContain('not used for food');
    });
  });
});

describe('adding head count to a group on a sprayed Area (C-29, review round 8)', () => {
  it('stops a helper status addition and an owner count change; a barn group passes', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(10);
      const made = await post(CREATE_GROUP, '/animal-groups', {
        name: 'Ewes',
        speciesId: 'sheep',
        headCount: 4
      });
      const groupId = made.body.group.id as string;
      const moved = await move({
        subjectType: 'group',
        subjectId: groupId,
        fieldId: farm.pastureId,
        movedAt: Date.now() - 2 * DAY
      });
      expect(moved.status).toBe(201);
      m.role = 'helper';
      const added = await status({
        subjectType: 'group',
        subjectId: groupId,
        status: 'active',
        headCountDelta: 20
      });
      expect(added.status).toBe(422);
      expect(added.body.code).toBe('GRAZING_UNKNOWN');
      expect(added.body.askOwner).toBe(true);
      m.role = 'owner';
      const patched = await call(GROUP_PATCH, `/animal-groups/${groupId}`, 'PATCH', {
        params: { id: groupId },
        body: { headCount: 24 }
      });
      expect(patched.status).toBe(422);
      expect(patched.body.code).toBe('GRAZING_UNKNOWN');
      expect(getAnimalGroup(groupId)?.headCount).toBe(4);

      const barnGroup = await ewes(farm, 3);
      const ok = await status({
        subjectType: 'group',
        subjectId: barnGroup,
        status: 'active',
        headCountDelta: 2
      });
      expect(ok.status).toBe(201);
      expect(getAnimalGroup(barnGroup)?.headCount).toBe(5);
    });
  });
});

describe('undoing a move onto a sprayed Area (C-30)', () => {
  it('keeps the move on record, so the food hold stays', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(10);
      const made = await post(CREATE_GROUP, '/animal-groups', {
        name: 'Sheep',
        speciesId: 'sheep',
        headCount: 4
      });
      const groupId = made.body.group.id as string;
      const moved = await move({
        subjectType: 'group',
        subjectId: groupId,
        fieldId: farm.pastureId,
        movedAt: Date.now() - 2 * DAY
      });
      expect(moved.status).toBe(201);
      const milk = {
        subjectType: 'group',
        subjectId: groupId,
        kind: 'milk',
        quantity: 1,
        unit: 'gal',
        use: 'food'
      };
      expect((await post(PRODUCTION, '/animals/production/record', milk)).status).toBe(422);
      const locationId = moved.body.move.location.id as string;
      const undo = await call(UNDO_MOVE, `/animals/locations/${locationId}`, 'DELETE', {
        params: { id: locationId }
      });
      expect(undo.status).toBe(409);
      expect(undo.body.code).toBe('STAY_HAS_GRAZING_HOLD');
      expect((await post(PRODUCTION, '/animals/production/record', milk)).status).toBe(422);
    });
  });
});

describe('deleting a sprayed block or Area (C-21)', () => {
  it('is refused while its grazing hold runs', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(10);
      const groupId = await ewes(farm);
      const block = await call(DELETE_BLOCK, `/blocks/${farm.blockId}`, 'DELETE', {
        params: { id: farm.blockId }
      });
      expect(block.status).toBe(409);
      expect(block.body.code).toBe('BLOCK_HAS_GRAZING_HOLD');
      expect(getBlock(farm.blockId)).toBeDefined();
      const area = await call(DELETE_FIELD, `/fields/${farm.pastureId}`, 'DELETE', {
        params: { id: farm.pastureId }
      });
      expect(area.status).toBe(409);
      expect(getField(farm.pastureId)).toBeDefined();
      const res = await move({ subjectType: 'group', subjectId: groupId, fieldId: farm.pastureId });
      expect(res.status).toBe(422);
    });
  });
});

describe('deleting a spray record (C-26, C-32)', () => {
  it('a helper cannot delete one that holds grazing; the owner delete keeps the hold', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(0);
      const groupId = await ewes(farm);
      m.role = 'helper';
      const del = () =>
        call(DELETE_SPRAY, `/spray/records/${farm.sprayId}`, 'DELETE', {
          params: { id: farm.sprayId }
        });
      const helper = await del();
      expect(helper.status).toBe(403);
      expect(helper.body.code).toBe('APPLICATION_HAS_GRAZING_HOLD');
      m.role = 'owner';
      expect((await del()).status).toBe(200);
      const tomb = db
        .select()
        .from(recordDeletions)
        .where(withTenant(recordDeletions, eq(recordDeletions.recordId, farm.sprayId)))
        .all();
      expect(tomb).toHaveLength(1);
      const res = await move({ subjectType: 'group', subjectId: groupId, fieldId: farm.pastureId });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('GRAZING_UNKNOWN');
    });
  });

  it('an owner cannot drop an unknown-label hold by saying it was never applied (C-35)', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(0);
      const groupId = await ewes(farm);
      // C-35 §5: dropping the hold is a void, and a grazing hold from an
      // unknown label is never voidable.
      const res = await call(DELETE_SPRAY, `/spray/records/${farm.sprayId}`, 'DELETE', {
        params: { id: farm.sprayId },
        query: '?neverApplied=true'
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('HOLD_NOT_VOIDABLE');
      const moved = await move({
        subjectType: 'group',
        subjectId: groupId,
        fieldId: farm.pastureId
      });
      expect(moved.status).toBe(422);
    });
  });
});

describe('a farm copy of a pesticide plugin (C-24, C-27)', () => {
  it('cannot clear or shorten the grazing time the shared library lacks', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(2, '2-4-d-amine');
      const groupId = await ewes(farm);
      expect(
        (await move({ subjectType: 'group', subjectId: groupId, fieldId: farm.pastureId })).status
      ).toBe(422);
      const shared = JSON.parse(
        readFileSync(
          path.resolve(__dirname, '../../../../../../plugins/herbicides/2-4-d-amine.json'),
          'utf8'
        )
      );
      const up = await post(UPLOAD, '/plugins/upload', {
        plugin: {
          ...shared,
          grazingRestrictions: {
            grazeDays: 0,
            hayDays: 0,
            lactatingDairyGrazeDays: 0,
            meatAnimalRemovalBeforeSlaughterDays: 0,
            source: 'my label'
          }
        }
      });
      expect(up.status).toBe(201);
      const res = await move({ subjectType: 'group', subjectId: groupId, fieldId: farm.pastureId });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('GRAZING_UNKNOWN');
    });
  });
});

describe('the hay gate cannot be dated around (C-28)', () => {
  it('refuses a mow dated in the future', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(10);
      const res = await post(HAY, '/hay/cuttings', {
        blockId: farm.blockId,
        cropPluginId: 'alfalfa-vernema',
        mowAt: Date.now() + 400 * DAY
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('IN_THE_FUTURE');
      expect(listCuttings({ blockId: farm.blockId })).toEqual([]);
    });
  });

  it('runs again on every step after the mow', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const pasture = createField({ name: 'Hay field', kind: 'pasture' });
      const block = createBlock({ name: 'Hay 1', fieldId: pasture.id, acres: 1 });
      const cut = await post(HAY, '/hay/cuttings', {
        blockId: block.id,
        cropPluginId: 'alfalfa-vernema'
      });
      expect(cut.status).toBe(201);
      const sprayerId = `sprayer-${randomUUID()}`;
      db.insert(equipment)
        .values(tenantValues({ id: sprayerId, type: 'sprayer' as const, label: 'Boom' }))
        .run();
      insertSprayEvent({
        blockId: block.id,
        sprayerId,
        performedById: 'gaps-user',
        occurredAt: Date.now() - HOUR,
        products: [{ pluginId: 'unsourced-weedkiller', chemistryClasses: ['glyphosate'] }],
        conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
        rulesVersion: 'test',
        pluginHashes: {}
      });
      const id = cut.body.cutting.id as string;
      const step = await call(HAY_STEP, `/hay/cuttings/${id}`, 'PATCH', {
        params: { id },
        body: { action: 'advance', step: 'ted' }
      });
      expect(step.status).toBe(422);
      expect(step.body.code).toBe('GRAZING_UNKNOWN');
      const future = await call(HAY_STEP, `/hay/cuttings/${id}`, 'PATCH', {
        params: { id },
        body: { action: 'advance', step: 'ted', occurredAt: Date.now() + 400 * DAY }
      });
      expect(future.status).toBe(400);
    });
  });
});

describe('a backdated food log sees applications inside its own lookback (C-23)', () => {
  it('blocks eggs from hens that grazed where an unsourced product went on 400 days ago', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(400);
      const made = await post(CREATE_GROUP, '/animal-groups', {
        name: 'Hens',
        speciesId: 'chicken',
        headCount: 6
      });
      const groupId = made.body.group.id as string;
      const moved = await move({
        subjectType: 'group',
        subjectId: groupId,
        fieldId: farm.pastureId,
        movedAt: Date.now() - 70 * DAY
      });
      expect(moved.status).toBe(201);
      const res = await post(PRODUCTION, '/animals/production/record', {
        subjectType: 'group',
        subjectId: groupId,
        kind: 'eggs',
        quantity: 6,
        unit: 'eggs',
        occurredAt: Date.now() - 50 * DAY,
        use: 'food'
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('GRAZING_UNKNOWN');
      expect(res.body.resubmitAs).toBe('discard');
    });
  });
});
