// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({
  role: 'owner' as string,
  impersonating: false,
  graze: { removeDays: 30 as number | undefined, grazeDays: 10 }
}));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: 'review-user', role: m.role, impersonating: m.impersonating });
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
    }
  };
  const extra = (): Record<string, object> => ({
    'review-remover': {
      pluginId: 'review-remover',
      type: 'herbicide',
      displayName: 'Remover',
      activeIngredients: [],
      grazingRestrictions: {
        source: 'test label',
        grazeDays: m.graze.grazeDays,
        hayDays: m.graze.grazeDays,
        lactatingDairyGrazeDays: m.graze.grazeDays,
        ...(m.graze.removeDays === undefined
          ? {}
          : { meatAnimalRemovalBeforeSlaughterDays: m.graze.removeDays })
      }
    },
    'review-dairy': {
      pluginId: 'review-dairy',
      type: 'herbicide',
      displayName: 'Dairy label',
      activeIngredients: [],
      grazingRestrictions: {
        source: 'test label',
        grazeDays: 3,
        hayDays: 3,
        lactatingDairyGrazeDays: 30,
        meatAnimalRemovalBeforeSlaughterDays: 0
      }
    },
    'review-banned': {
      pluginId: 'review-banned',
      type: 'herbicide',
      displayName: 'Banned',
      activeIngredients: [],
      grazingRestrictions: { source: 'test label', notForPasture: true }
    }
  });
  type Registry = Awaited<ReturnType<typeof actual.getRegistry>>;
  const wrap = (reg: Registry): Registry =>
    new Proxy(reg, {
      get(target, prop) {
        if (prop === 'get') {
          return (id: string) => {
            const plugin = extra()[id];
            return plugin ? { plugin } : target.get(id);
          };
        }
        if (prop === 'all') {
          return () => [...target.all(), ...Object.values(extra()).map((plugin) => ({ plugin }))];
        }
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      }
    }) as Registry;
  return {
    ...actual,
    getRegistry: async () => wrap(await actual.getRegistry()),
    getBaseRegistry: async () => wrap(await actual.getBaseRegistry()),
    getDataKinds: async () => ({
      species: { get: (id: string) => species[id] },
      animalHealth: { get: () => undefined, has: () => false }
    })
  };
});

import { db } from '$lib/db/client';
import { animalHealthEvents, equipment, owners, sprayEvents, users } from '$lib/db/schema';
import { runWithTenantAsync, tenantValues, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock, getBlock } from '$lib/db/blocks';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import { insertGrazingAttestation } from '$lib/db/grazingAttestations';
import { listLocationsForSubject } from '$lib/db/animalLocations';
import { getHealthEvent } from '$lib/db/animalHealth';
import { RULES_VERSION } from '$lib/safety/version';
import { eq } from 'drizzle-orm';

import { POST as CREATE } from './+server';
import { PATCH as PATCH_ANIMAL } from './[id]/+server';
import { POST as MOVE } from './move/+server';
import { POST as STATUS } from './status/+server';
import { POST as PRODUCTION } from './production/record/+server';
import { POST as HEALTH } from './health/record/+server';
import { POST as ENTRIES } from './health/[id]/entries/+server';
import { DELETE as DELETE_HEALTH } from './health/[id]/+server';
import { POST as ATTEST } from './grazing-attestations/+server';
import { POST as CREATE_GROUP } from '../animal-groups/+server';
import { PATCH as PATCH_BLOCK } from '../blocks/[id]/+server';
import { DELETE as DELETE_SPRAYER } from '../sprayers/[id]/+server';
import { POST as HARVEST } from '../harvest/record/+server';
import { DELETE as DELETE_SPRAY } from '../spray/records/[id]/+server';
import { DELETE as DELETE_INSECTICIDE } from '../insecticide/[id]/+server';
import { DELETE as DELETE_FIELD } from '../fields/[id]/+server';
import { DELETE as DELETE_LOCATION } from './locations/[id]/+server';
import { DELETE as DELETE_PRODUCTION } from './production/[id]/+server';
import { createPlanned } from '$lib/db/crops';
import { listFlagChanges } from '$lib/db/animals';
import { insertInsecticideEvent } from '$lib/db/insecticideEvents';
import { recordDeletions } from '$lib/db/schema';

const DAY = 86_400_000;
const HOUR = 3_600_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function seedOwner(): string {
  const id = `review-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: 'review-user', email: 'review@test.local' })
    .onConflictDoNothing()
    .run();
  return id;
}

async function call(
  handler: unknown,
  path: string,
  method: string,
  opts: {
    params?: Record<string, string>;
    body?: unknown;
    query?: string;
    locals?: Record<string, unknown>;
  } = {}
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
      locals: opts.locals ?? {}
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
const produce = (subjectType: string, subjectId: string, kind = 'eggs', use = 'food') =>
  post(PRODUCTION, '/animals/production/record', {
    subjectType,
    subjectId,
    kind,
    quantity: 6,
    unit: kind === 'milk' ? 'gal' : 'eggs',
    use
  });

interface Farm {
  barnId: string;
  pastureId: string;
  blockId: string;
  sprayId: string;
  sprayerId: string;
}

function barn(name = 'Barn'): string {
  return createField({ name, kind: 'barn' }).id;
}

function sprayedPasture(daysAgo = 10, pluginId = 'unsourced-weedkiller'): Farm {
  const barnId = barn();
  const pasture = createField({ name: 'North pasture', kind: 'pasture' });
  const block = createBlock({ name: 'Paddock 1', fieldId: pasture.id, acres: 1 });
  const sprayerId = `sprayer-${randomUUID()}`;
  db.insert(equipment)
    .values(tenantValues({ id: sprayerId, type: 'sprayer' as const, label: 'Backpack' }))
    .run();
  const spray = insertSprayEvent({
    blockId: block.id,
    sprayerId,
    performedById: 'review-user',
    occurredAt: Date.now() - daysAgo * DAY,
    products: [{ pluginId, chemistryClasses: ['synthetic-auxin'] }],
    conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
    rulesVersion: 'test',
    pluginHashes: {}
  });
  return { barnId, pastureId: pasture.id, blockId: block.id, sprayId: spray.id, sprayerId };
}

async function flock(
  name: string,
  opts: { headCount?: number; housingFieldId?: string; members?: string[] } = {}
): Promise<{ groupId: string; memberIds: string[] }> {
  const res = await post(CREATE_GROUP, '/animal-groups', {
    name,
    speciesId: 'chicken',
    headCount: opts.headCount ?? 12,
    ...(opts.housingFieldId ? { housingFieldId: opts.housingFieldId } : {}),
    members: (opts.members ?? []).map((n) => ({ name: n }))
  });
  expect(res.status).toBe(201);
  return {
    groupId: res.body.group.id,
    memberIds: (res.body.members as Json[]).map((a) => a.id)
  };
}

function treat(
  subjectType: 'animal' | 'group',
  subjectId: string,
  at: number,
  productName = 'Farm store antibiotic'
) {
  db.insert(animalHealthEvents)
    .values(
      tenantValues({
        id: randomUUID(),
        subjectType,
        subjectId,
        kind: 'treatment' as const,
        productName,
        administeredAt: new Date(at),
        foodProducingAtRecord: true
      })
    )
    .run();
}

beforeEach(() => {
  m.role = 'owner';
  m.impersonating = false;
  m.graze = { removeDays: 30, grazeDays: 10 };
});

describe('backdating a split, a leave or a join after a group treatment', () => {
  it('is refused, so the group hold still reaches the leavers', async () => {
    for (const product of ['Farm store antibiotic', 'Baytril']) {
      m.role = 'owner';
      await runWithTenantAsync(seedOwner(), async () => {
        const coop = barn('Coop');
        const coop2 = barn('Coop 2');
        const layers = await flock('Layers', { members: ['Ada', 'Bea'] });
        const [ada, bea] = layers.memberIds;
        const housed = await move({
          subjectType: 'group',
          subjectId: layers.groupId,
          fieldId: coop,
          movedAt: Date.now() - 3 * DAY
        });
        expect(housed.status).toBe(201);
        treat('group', layers.groupId, Date.now() - HOUR, product);
        const code = product === 'Baytril' ? 'PROHIBITED_DRUG' : 'WITHDRAWAL_UNKNOWN';
        expect((await produce('group', layers.groupId)).body.code).toBe(code);
        const other = await flock('Other', { housingFieldId: coop2 });
        m.role = 'helper';
        const back = Date.now() - 2 * DAY;
        const split = await move({
          subjectType: 'group',
          subjectId: layers.groupId,
          count: 5,
          animalIds: [ada],
          fieldId: coop2,
          movedAt: back
        });
        expect(split.status).toBe(409);
        expect(split.body.code).toBe('OUT_OF_ORDER');
        expect(split.body.error).toContain(`${product} was given on`);
        const leave = await move({
          subjectType: 'animal',
          subjectId: bea,
          fieldId: coop2,
          movedAt: back
        });
        expect(leave.status).toBe(409);
        const join = await move({
          subjectType: 'animal',
          subjectId: bea,
          toGroupId: other.groupId,
          movedAt: back
        });
        expect(join.status).toBe(409);

        const splitNow = await move({
          subjectType: 'group',
          subjectId: layers.groupId,
          count: 5,
          animalIds: [ada],
          fieldId: coop2
        });
        expect(splitNow.status).toBe(201);
        const child = splitNow.body.move.newGroup.id as string;
        expect((await produce('group', child)).body.code).toBe(code);
        expect((await produce('animal', ada)).body.code).toBe(code);
        const joinNow = await move({
          subjectType: 'animal',
          subjectId: bea,
          toGroupId: other.groupId
        });
        expect(joinNow.status).toBe(201);
        expect((await produce('animal', bea, 'eggs', 'sale')).body.code).toBe(code);
        expect(
          (
            await status({
              subjectType: 'group',
              subjectId: child,
              status: 'slaughtered',
              headCountDelta: -5
            })
          ).status
        ).toBe(422);
      });
    }
  });

  it('refuses a leave dated before the group last moved', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const coop = barn('Coop');
      const coop2 = barn('Coop 2');
      const layers = await flock('Layers', { members: ['Ada'] });
      await move({
        subjectType: 'group',
        subjectId: layers.groupId,
        fieldId: coop,
        movedAt: Date.now() - DAY
      });
      m.role = 'helper';
      const leave = await move({
        subjectType: 'animal',
        subjectId: layers.memberIds[0],
        fieldId: coop2,
        movedAt: Date.now() - 2 * DAY
      });
      expect(leave.status).toBe(409);
      expect(leave.body.code).toBe('OUT_OF_ORDER');
    });
  });
});

describe('backdating a move off a sprayed Area', () => {
  it('cannot cut the stay back to before the spray', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(5);
      const layers = await flock('Layers');
      const on = await move({
        subjectType: 'group',
        subjectId: layers.groupId,
        fieldId: farm.pastureId,
        movedAt: Date.now() - 10 * DAY
      });
      expect(on.status).toBe(201);
      expect((await produce('group', layers.groupId)).status).toBe(422);
      m.role = 'helper';
      const off = await move({
        subjectType: 'group',
        subjectId: layers.groupId,
        fieldId: farm.barnId,
        movedAt: Date.now() - 6 * DAY
      });
      expect(off.status).toBe(409);
      expect(off.body.code).toBe('STAY_HAS_GRAZING_HOLD');
      expect((await produce('group', layers.groupId)).status).toBe(422);
      const offNow = await move({
        subjectType: 'group',
        subjectId: layers.groupId,
        fieldId: farm.barnId
      });
      expect(offNow.status).toBe(201);
      expect((await produce('group', layers.groupId)).status).toBe(422);
    });
  });
});

describe('a meat declaration dated before the move that took the animals onto the Area', () => {
  it('is refused for a group and for a grouped animal', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(10);
      const broilers = await flock('Broilers', { headCount: 5, members: ['Hen'] });
      const moved = await move({
        subjectType: 'group',
        subjectId: broilers.groupId,
        fieldId: farm.pastureId,
        movedAt: Date.now() - 3 * DAY
      });
      expect(moved.status).toBe(201);
      m.role = 'helper';
      const slaughter = (subjectType: string, subjectId: string, occurredAt?: number) =>
        status({
          subjectType,
          subjectId,
          status: 'slaughtered',
          ...(subjectType === 'group' ? { headCountDelta: -2 } : {}),
          ...(occurredAt ? { occurredAt } : {})
        });
      expect((await slaughter('group', broilers.groupId)).body.code).toBe('GRAZING_UNKNOWN');
      const back = await slaughter('group', broilers.groupId, Date.now() - 4 * DAY);
      expect(back.status).toBe(409);
      expect(back.body.code).toBe('OUT_OF_ORDER');
      const hen = broilers.memberIds[0];
      expect((await slaughter('animal', hen)).status).toBe(422);
      const henBack = await slaughter('animal', hen, Date.now() - 4 * DAY);
      expect(henBack.status).toBe(409);
      expect(henBack.body.code).toBe('OUT_OF_ORDER');
    });
  });
});

describe("a member's exposure from its old flock (C-16)", () => {
  it("holds its new flock's eggs while it is a member", async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(10);
      const range = await flock('Range', { members: ['Hen'] });
      const coop = await flock('Coop flock', { housingFieldId: farm.barnId });
      const moved = await move({
        subjectType: 'group',
        subjectId: range.groupId,
        fieldId: farm.pastureId,
        movedAt: Date.now() - 3 * HOUR
      });
      expect(moved.status).toBe(201);
      expect((await produce('group', coop.groupId)).status).toBe(201);
      m.role = 'helper';
      const hen = range.memberIds[0];
      const join = await move({ subjectType: 'animal', subjectId: hen, toGroupId: coop.groupId });
      expect(join.status).toBe(201);
      expect((await produce('animal', hen)).status).toBe(422);
      const coopEggs = await produce('group', coop.groupId);
      expect(coopEggs.status).toBe(422);
      expect(coopEggs.body.code).toBe('GRAZING_UNKNOWN');
      const left = await move({ subjectType: 'animal', subjectId: hen, fieldId: farm.barnId });
      expect(left.status).toBe(201);
      expect((await produce('group', coop.groupId)).status).toBe(201);
    });
  });
});

describe('moving a sprayed block to another Area (C-21)', () => {
  it('is refused while animals that grazed there still have meat on hold', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(20);
      const other = createField({ name: 'South pasture', kind: 'pasture' });
      insertGrazingAttestation({
        fieldId: farm.pastureId,
        sprayEventRef: `spray:${farm.sprayId}`,
        productPluginId: 'unsourced-weedkiller',
        grazeDays: 7,
        hayDays: 7,
        lactatingGrazeDays: 7,
        reason: 'Label',
        attestedBy: 'review-user'
      });
      const lamb = await post(CREATE, '/animals', {
        speciesId: 'sheep',
        tag: 'L1',
        sex: 'male',
        housingFieldId: farm.barnId
      });
      const lambId = lamb.body.animal.id as string;
      const on = await move({
        subjectType: 'animal',
        subjectId: lambId,
        fieldId: farm.pastureId,
        movedAt: Date.now() - 16 * DAY
      });
      expect(on.status).toBe(201);
      const sale = { subjectType: 'animal', subjectId: lambId, status: 'sold-for-meat' };
      expect((await status(sale)).body.code).toBe('GRAZING_UNKNOWN');
      const patch = await call(PATCH_BLOCK, `/blocks/${farm.blockId}`, 'PATCH', {
        params: { id: farm.blockId },
        body: { fieldId: other.id }
      });
      expect(patch.status).toBe(409);
      expect(patch.body.error).toBe('BLOCK_HAS_GRAZING_HOLD');
      expect(getBlock(farm.blockId)?.fieldId).toBe(farm.pastureId);
      expect((await status(sale)).status).toBe(422);
    });
  });

  it('is refused during a label pre-slaughter removal hold', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      m.graze = { removeDays: 30, grazeDays: 0 };
      const farm = sprayedPasture(5, 'review-remover');
      const other = createField({ name: 'South pasture', kind: 'pasture' });
      const made = await post(CREATE_GROUP, '/animal-groups', {
        name: 'Sheep',
        speciesId: 'sheep',
        headCount: 4
      });
      const groupId = made.body.group.id as string;
      const on = await move({
        subjectType: 'group',
        subjectId: groupId,
        fieldId: farm.pastureId,
        movedAt: Date.now() - 10 * DAY
      });
      expect(on.status).toBe(201);
      const slaughter = {
        subjectType: 'group',
        subjectId: groupId,
        status: 'slaughtered',
        headCountDelta: -1
      };
      expect((await status(slaughter)).body.code).toBe('GRAZING_INTERVAL');
      const patch = await call(PATCH_BLOCK, `/blocks/${farm.blockId}`, 'PATCH', {
        params: { id: farm.blockId },
        body: { fieldId: other.id }
      });
      expect(patch.status).toBe(409);
      expect((await status(slaughter)).status).toBe(422);
    });
  });
});

describe('a stored exposure floor (C-18 for grazing)', () => {
  it('keeps the hold the move was saved with when the label data later shortens', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      m.graze = { removeDays: 0, grazeDays: 10 };
      const farm = sprayedPasture(1, 'review-remover');
      const layers = await flock('Layers');
      const on = await move({
        subjectType: 'group',
        subjectId: layers.groupId,
        fieldId: farm.pastureId,
        movedAt: Date.now() - 2 * HOUR
      });
      expect(on.status).toBe(201);
      const stay = listLocationsForSubject('group', layers.groupId).at(-1)!;
      expect(stay.rulesVersion).toBe(RULES_VERSION);
      expect(JSON.parse(stay.exposureFloor!).entries.length).toBeGreaterThan(0);
      expect((await produce('group', layers.groupId)).body.code).toBe('GRAZING_INTERVAL');
      m.graze = { removeDays: 0, grazeDays: 0 };
      const eggs = await produce('group', layers.groupId);
      expect(eggs.status).toBe(422);
      expect(eggs.body.code).toBe('GRAZING_INTERVAL');
    });
  });
});

describe('a label that forbids grazing', () => {
  it('names the date the stop lifts and the way forward', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(10, 'review-banned');
      const layers = await flock('Layers', { housingFieldId: farm.barnId });
      const stop = await move({
        subjectType: 'group',
        subjectId: layers.groupId,
        fieldId: farm.pastureId
      });
      expect(stop.status).toBe(422);
      expect(stop.body.code).toBe('GRAZING_PROHIBITED');
      expect(stop.body.holdEndsAtMs).toBeGreaterThan(Date.now() + 300 * DAY);
      expect(stop.body.error).toContain('when that spray no longer counts');
      expect(stop.body.error).toContain('Pick another Area');
      const back = await move({
        subjectType: 'group',
        subjectId: layers.groupId,
        fieldId: farm.pastureId,
        movedAt: Date.now() - 2 * HOUR
      });
      expect(back.status).toBe(201);
      const eggs = await produce('group', layers.groupId);
      expect(eggs.body).toMatchObject({ code: 'GRAZING_PROHIBITED', nextStep: 'wait' });
      expect(eggs.body.holdEndsOn).toEqual(expect.any(String));
      expect(eggs.body.error).toContain('when that spray no longer counts');
    });
  });
});

describe('owner-only withdrawal and grazing steps (C-01, C-32)', () => {
  const bearer = { authVia: 'bearer' };

  async function treated(): Promise<{ animalId: string; eventId: string }> {
    const made = await post(CREATE, '/animals', { speciesId: 'chicken', name: 'Hen' });
    const animalId = made.body.animal.id as string;
    const rec = await post(HEALTH, '/animals/health/record', {
      subjectType: 'animal',
      subjectId: animalId,
      kind: 'treatment',
      productName: 'Some wormer',
      administeredAt: Date.now() - HOUR
    });
    expect(rec.status).toBe(201);
    return { animalId, eventId: rec.body.event.id };
  }

  const labelEntry = {
    kind: 'label',
    food: 'eggs',
    amount: 0,
    unit: 'days',
    labelNamesSpeciesAndClass: true,
    labelSaysNone: true
  };

  it('refuses an API token and an impersonating superadmin', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { animalId, eventId } = await treated();
      const entry = (locals: Record<string, unknown> = {}) =>
        call(ENTRIES, `/animals/health/${eventId}/entries`, 'POST', {
          params: { id: eventId },
          body: labelEntry,
          locals
        });
      const token = await entry(bearer);
      expect(token.status).toBe(403);
      expect(token.body.code).toBe('INTERACTIVE_OWNER_ONLY');
      m.impersonating = true;
      expect((await entry()).status).toBe(403);
      m.impersonating = false;
      expect((await produce('animal', animalId)).body.code).toBe('WITHDRAWAL_UNKNOWN');
      expect((await entry()).status).toBe(201);
      expect((await produce('animal', animalId)).body.code).toBe('WITHDRAWAL_ACTIVE');
    });
  });

  it('refuses a grazing attestation and a never-given delete from an API token', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(10);
      const attest = await call(ATTEST, '/animals/grazing-attestations', 'POST', {
        body: {
          fieldId: farm.pastureId,
          reason: 'Label',
          items: [{ sprayEventRef: `spray:${farm.sprayId}`, grazeDays: 0, lactatingGrazeDays: 0 }]
        },
        locals: bearer
      });
      expect(attest.status).toBe(403);
      const { eventId } = await treated();
      const del = await call(DELETE_HEALTH, `/animals/health/${eventId}`, 'DELETE', {
        params: { id: eventId },
        query: '?neverGiven=true',
        locals: bearer
      });
      expect(del.status).toBe(403);
      expect(getHealthEvent(eventId)).toBeDefined();
    });
  });

  it('saves an on-label claim from an API token as "not sure"', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const made = await post(CREATE, '/animals', { speciesId: 'chicken', name: 'Hen' });
      const rec = await call(HEALTH, '/animals/health/record', 'POST', {
        body: {
          subjectType: 'animal',
          subjectId: made.body.animal.id,
          kind: 'treatment',
          productName: 'Some wormer',
          administeredAt: Date.now() - HOUR,
          labelUse: 'label'
        },
        locals: bearer
      });
      expect(rec.status).toBe(201);
      expect(rec.body.event.labelUse).toBe('unknown');
      expect(rec.body.warnings.map((w: Json) => w.code)).toContain('LABEL_USE_OWNER');
    });
  });
});

describe('DELETE /api/sprayers/:id', () => {
  it('never erases spray records or their grazing holds', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(10);
      const del = (role: string) => {
        m.role = role;
        return call(DELETE_SPRAYER, `/sprayers/${farm.sprayerId}`, 'DELETE', {
          params: { id: farm.sprayerId }
        });
      };
      expect((await del('helper')).status).toBe(403);
      const owner = await del('owner');
      expect(owner.status).toBe(409);
      expect(owner.body.code).toBe('SPRAYER_HAS_RECORDS');
      const rows = db
        .select()
        .from(sprayEvents)
        .where(withTenant(sprayEvents, eq(sprayEvents.id, farm.sprayId)))
        .all();
      expect(rows).toHaveLength(1);
      const stale = await call(DELETE_SPRAYER, '/sprayers/legacy-row', 'DELETE', {
        params: { id: 'legacy-row' }
      });
      expect(stale.status).toBe(200);
    });
  });
});

describe('POST /api/harvest/record for a hay crop (C-28)', () => {
  it('runs the haying gate', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(10);
      m.role = 'helper';
      const hay = await post(HARVEST, '/harvest/record', {
        blockId: farm.blockId,
        cropPluginId: 'alfalfa-vernema',
        quantity: '40 bales'
      });
      expect(hay.status).toBe(422);
      expect(hay.body.code).toBe('GRAZING_UNKNOWN');
      const tomatoes = await post(HARVEST, '/harvest/record', {
        blockId: farm.blockId,
        cropPluginId: 'tomato-amish-paste',
        quantity: '10 lb'
      });
      expect(tomatoes.status).toBe(200);
    });
  });
});

describe('round 3: backdated records that end time in a group (C-30, C-31)', () => {
  async function onSprayedPasture(sprayDaysAgo: number, arrivedDaysAgo: number) {
    const farm = sprayedPasture(sprayDaysAgo);
    const coop2 = barn('Coop 2');
    const layers = await flock('Layers', { members: ['Ada', 'Bea', 'Cee'] });
    const other = await flock('Other', { housingFieldId: coop2 });
    const on = await move({
      subjectType: 'group',
      subjectId: layers.groupId,
      fieldId: farm.pastureId,
      movedAt: Date.now() - arrivedDaysAgo * DAY
    });
    expect(on.status).toBe(201);
    return { farm, coop2, layers, other };
  }

  it('refuses a split, a leave and a join dated before a spray made while the group was there', async () => {
    for (const [spray, arrived, back] of [
      [5, 10, 7],
      [3, 10, 5]
    ]) {
      m.role = 'owner';
      await runWithTenantAsync(seedOwner(), async () => {
        const { coop2, layers, other } = await onSprayedPasture(spray, arrived);
        const [ada, bea, cee] = layers.memberIds;
        expect((await produce('animal', ada)).status).toBe(422);
        m.role = 'helper';
        const movedAt = Date.now() - back * DAY;
        const split = await move({
          subjectType: 'group',
          subjectId: layers.groupId,
          count: 5,
          animalIds: [ada],
          fieldId: coop2,
          movedAt
        });
        expect(split.status).toBe(409);
        expect(split.body.code).toBe('STAY_HAS_GRAZING_HOLD');
        const leave = await move({
          subjectType: 'animal',
          subjectId: bea,
          fieldId: coop2,
          movedAt
        });
        expect(leave.status).toBe(409);
        expect(leave.body.code).toBe('STAY_HAS_GRAZING_HOLD');
        const join = await move({
          subjectType: 'animal',
          subjectId: cee,
          toGroupId: other.groupId,
          movedAt
        });
        expect(join.status).toBe(409);
        expect(join.body.code).toBe('STAY_HAS_GRAZING_HOLD');
        for (const id of [ada, bea, cee]) expect((await produce('animal', id)).status).toBe(422);
        expect((await produce('group', other.groupId)).status).toBe(201);

        const splitNow = await move({
          subjectType: 'group',
          subjectId: layers.groupId,
          count: 5,
          animalIds: [ada],
          fieldId: coop2
        });
        expect(splitNow.status).toBe(201);
        const child = splitNow.body.move.newGroup.id as string;
        expect((await produce('group', child)).status).toBe(422);
        expect((await move({ subjectType: 'animal', subjectId: bea, fieldId: coop2 })).status).toBe(
          201
        );
        expect((await produce('animal', bea)).status).toBe(422);
        const joinNow = await move({
          subjectType: 'animal',
          subjectId: cee,
          toGroupId: other.groupId
        });
        expect(joinNow.status).toBe(201);
        expect((await produce('animal', cee)).status).toBe(422);
      });
    }
  });

  it('still allows a split dated after the spray', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { coop2, layers } = await onSprayedPasture(5, 10);
      m.role = 'helper';
      const split = await move({
        subjectType: 'group',
        subjectId: layers.groupId,
        count: 2,
        fieldId: coop2,
        movedAt: Date.now() - 2 * DAY
      });
      expect(split.status).toBe(201);
      expect((await produce('group', split.body.move.newGroup.id)).status).toBe(422);
    });
  });
});

describe('round 3: a backdated slaughter across a spray (C-17, C-30)', () => {
  it('is refused for an ungrouped animal and for part of a group', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(5);
      const ewe = (await post(CREATE, '/animals', { speciesId: 'sheep', name: 'Ewe' })).body.animal
        .id as string;
      const broilers = await flock('Broilers', { headCount: 5 });
      for (const [subjectType, subjectId] of [
        ['animal', ewe],
        ['group', broilers.groupId]
      ]) {
        const on = await move({
          subjectType,
          subjectId,
          fieldId: farm.pastureId,
          movedAt: Date.now() - 10 * DAY
        });
        expect(on.status).toBe(201);
      }
      m.role = 'helper';
      const occurredAt = Date.now() - 7 * DAY;
      const eweBack = await status({
        subjectType: 'animal',
        subjectId: ewe,
        status: 'slaughtered',
        occurredAt
      });
      expect(eweBack.status).toBe(409);
      expect(eweBack.body.code).toBe('STAY_HAS_GRAZING_HOLD');
      const groupBack = await status({
        subjectType: 'group',
        subjectId: broilers.groupId,
        status: 'slaughtered',
        headCountDelta: -1,
        occurredAt
      });
      expect(groupBack.status).toBe(409);
      expect(
        (await status({ subjectType: 'animal', subjectId: ewe, status: 'slaughtered' })).status
      ).toBe(422);
      expect(listLocationsForSubject('animal', ewe).at(-1)!.toMs).toBeNull();
    });
  });
});

describe('round 3: a backdated move and the pre-slaughter removal', () => {
  it('cannot end the removal hold sooner than the animals really left', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      m.graze = { removeDays: 3, grazeDays: 0 };
      const farm = sprayedPasture(30, 'review-remover');
      const sheep = await post(CREATE_GROUP, '/animal-groups', {
        name: 'Flock',
        speciesId: 'sheep',
        headCount: 6
      });
      const groupId = sheep.body.group.id as string;
      const on = await move({
        subjectType: 'group',
        subjectId: groupId,
        fieldId: farm.pastureId,
        movedAt: Date.now() - 10 * DAY
      });
      expect(on.status).toBe(201);
      const slaughter = () =>
        status({
          subjectType: 'group',
          subjectId: groupId,
          status: 'slaughtered',
          headCountDelta: -1
        });
      expect((await slaughter()).body.code).toBe('GRAZING_INTERVAL');
      m.role = 'helper';
      const off = await move({
        subjectType: 'group',
        subjectId: groupId,
        fieldId: farm.barnId,
        movedAt: Date.now() - 5 * DAY
      });
      expect(off.status).toBe(409);
      expect(off.body.code).toBe('STAY_HAS_GRAZING_HOLD');
      expect((await slaughter()).status).toBe(422);
      expect(
        (await move({ subjectType: 'group', subjectId: groupId, fieldId: farm.barnId })).status
      ).toBe(201);
      expect((await slaughter()).status).toBe(422);
    });
  });
});

describe('round 3: deleting an Area that holds a group split', () => {
  it('is refused, so the split-off group keeps its inherited hold', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(3);
      const coopC = barn('Coop C');
      const coopD = barn('Coop D');
      const layers = await flock('Layers');
      expect(
        (
          await move({
            subjectType: 'group',
            subjectId: layers.groupId,
            fieldId: farm.pastureId,
            movedAt: Date.now() - 4 * DAY
          })
        ).status
      ).toBe(201);
      expect(
        (
          await move({
            subjectType: 'group',
            subjectId: layers.groupId,
            fieldId: farm.barnId,
            movedAt: Date.now() - 2 * DAY
          })
        ).status
      ).toBe(201);
      const split = await move({
        subjectType: 'group',
        subjectId: layers.groupId,
        count: 5,
        fieldId: coopC,
        movedAt: Date.now() - DAY
      });
      expect(split.status).toBe(201);
      const child = split.body.move.newGroup.id as string;
      expect((await produce('group', child)).status).toBe(422);
      expect((await move({ subjectType: 'group', subjectId: child, fieldId: coopD })).status).toBe(
        201
      );
      const del = await call(DELETE_FIELD, `/fields/${coopC}`, 'DELETE', { params: { id: coopC } });
      expect(del.status).toBe(409);
      expect(del.body.code).toBe('AREA_HAS_GROUP_HISTORY');
      expect((await produce('group', child)).status).toBe(422);
      const empty = barn('Empty shed');
      expect(
        (await call(DELETE_FIELD, `/fields/${empty}`, 'DELETE', { params: { id: empty } })).status
      ).toBe(200);
    });
  });
});

describe('round 3: the stored floor protects the move itself', () => {
  it('refuses deleting a move whose floor still holds the food after a relabel', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      m.graze = { removeDays: 0, grazeDays: 30 };
      const farm = sprayedPasture(10, 'review-remover');
      const layers = await flock('Layers');
      await move({
        subjectType: 'group',
        subjectId: layers.groupId,
        fieldId: farm.barnId,
        movedAt: Date.now() - 3 * DAY
      });
      const on = await move({
        subjectType: 'group',
        subjectId: layers.groupId,
        fieldId: farm.pastureId,
        movedAt: Date.now() - 2 * HOUR
      });
      expect(on.status).toBe(201);
      const stay = listLocationsForSubject('group', layers.groupId).at(-1)!;
      expect(stay.exposureFloor).not.toBeNull();
      expect((await produce('group', layers.groupId)).status).toBe(422);
      m.graze = { removeDays: 0, grazeDays: 5 };
      expect((await produce('group', layers.groupId)).status).toBe(422);
      const del = await call(DELETE_LOCATION, `/animals/locations/${stay.id}`, 'DELETE', {
        params: { id: stay.id }
      });
      expect(del.status).toBe(409);
      expect(del.body.code).toBe('STAY_HAS_GRAZING_HOLD');
      expect((await produce('group', layers.groupId)).status).toBe(422);
    });
  });
});

describe('round 3: "never applied" is for the interactive owner (C-26)', () => {
  it('refuses an API token and an impersonating superadmin on spray and insecticide deletes', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(1);
      const insecticide = insertInsecticideEvent({
        blockId: farm.blockId,
        sprayerId: farm.sprayerId,
        performedById: 'review-user',
        occurredAt: Date.now() - DAY,
        products: [{ pluginId: 'unsourced-bug-spray', displayName: 'Bug spray', iracGroups: [] }],
        conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
        rulesVersion: 'test',
        pluginHashes: {}
      });
      const layers = await flock('Layers', { housingFieldId: farm.barnId });
      const onto = () =>
        move({ subjectType: 'group', subjectId: layers.groupId, fieldId: farm.pastureId });
      expect((await onto()).status).toBe(422);
      const cases: Array<[unknown, string, string]> = [
        [DELETE_SPRAY, `/spray/records/${farm.sprayId}`, farm.sprayId],
        [DELETE_INSECTICIDE, `/insecticide/${insecticide.id}`, insecticide.id]
      ];
      for (const [handler, path, id] of cases) {
        const token = await call(handler, path, 'DELETE', {
          params: { id },
          query: '?neverApplied=true',
          locals: { authVia: 'bearer' }
        });
        expect(token.status).toBe(403);
        expect(token.body.code).toBe('INTERACTIVE_OWNER_ONLY');
        m.impersonating = true;
        const imp = await call(handler, path, 'DELETE', {
          params: { id },
          query: '?neverApplied=true'
        });
        expect(imp.status).toBe(403);
        m.impersonating = false;
      }
      expect((await onto()).status).toBe(422);
      for (const [handler, path, id] of cases) {
        // C-35 §5: "never applied" that drops held time is a void, and a
        // grazing hold from an unknown label is never voidable. (The first
        // delete may drop none, when the other application covers the
        // same time.)
        const owner = await call(handler, path, 'DELETE', {
          params: { id },
          query: '?neverApplied=true'
        });
        if (owner.status !== 200) {
          expect(owner.status).toBe(403);
          expect(owner.body.code).toBe('HOLD_NOT_VOIDABLE');
        }
      }
      expect((await onto()).status).toBe(422);
    });
  });
});

describe('round 3: deleting a food or sale log a hold now covers (C-06)', () => {
  it('is owner-only, and every delete leaves a tombstone', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const layers = await flock('Layers');
      const sold = await produce('group', layers.groupId, 'eggs', 'sale');
      expect(sold.status).toBe(201);
      const kept = await produce('group', layers.groupId, 'eggs', 'discard');
      expect(kept.status).toBe(201);
      const rec = await post(HEALTH, '/animals/health/record', {
        subjectType: 'group',
        subjectId: layers.groupId,
        kind: 'treatment',
        productName: 'Some wormer',
        administeredAt: Date.now() - 3 * DAY
      });
      expect(rec.status).toBe(201);
      const del = (id: string) =>
        call(DELETE_PRODUCTION, `/animals/production/${id}`, 'DELETE', { params: { id } });
      const tombstones = (id: string) =>
        db
          .select()
          .from(recordDeletions)
          .where(withTenant(recordDeletions, eq(recordDeletions.recordId, id)))
          .all().length;
      m.role = 'helper';
      const soldId = sold.body.log.id as string;
      const refused = await del(soldId);
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('LOG_UNDER_HOLD');
      expect(tombstones(soldId)).toBe(0);
      const keptId = kept.body.log.id as string;
      expect((await del(keptId)).status).toBe(200);
      expect(tombstones(keptId)).toBe(1);
      m.role = 'owner';
      expect((await del(soldId)).status).toBe(200);
      expect(tombstones(soldId)).toBe(1);
    });
  });
});

describe('round 3: rules_version on gated creates and hay cuts', () => {
  it('stores the placement gate result with the stay, and stamps a cleared hay cut', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      m.graze = { removeDays: 30, grazeDays: 10 };
      const farm = sprayedPasture(20, 'review-remover');
      const group = await post(CREATE_GROUP, '/animal-groups', {
        name: 'Flock',
        speciesId: 'sheep',
        headCount: 4,
        housingFieldId: farm.pastureId
      });
      expect(group.status).toBe(201);
      const groupStay = listLocationsForSubject('group', group.body.group.id).at(-1)!;
      expect(groupStay.rulesVersion).toBe(RULES_VERSION);
      expect(JSON.parse(groupStay.exposureFloor!).entries.length).toBeGreaterThan(0);
      const ewe = await post(CREATE, '/animals', {
        speciesId: 'sheep',
        name: 'Ewe',
        housingFieldId: farm.pastureId
      });
      expect(ewe.status).toBe(201);
      const eweStay = listLocationsForSubject('animal', ewe.body.animal.id).at(-1)!;
      expect(eweStay.rulesVersion).toBe(RULES_VERSION);
      expect(eweStay.exposureFloor).not.toBeNull();

      const hay = await post(HARVEST, '/harvest/record', {
        blockId: farm.blockId,
        cropPluginId: 'alfalfa-vernema',
        quantity: '40 bales'
      });
      expect(hay.status).toBe(200);
      expect(hay.body.event.rulesVersion).toBe(RULES_VERSION);
      const tomatoes = await post(HARVEST, '/harvest/record', {
        blockId: farm.blockId,
        cropPluginId: 'tomato-amish-paste',
        quantity: '10 lb'
      });
      expect(tomatoes.status).toBe(200);
      expect(tomatoes.body.event.rulesVersion).toBeUndefined();
    });
  });
});

describe('round 4: every forage cut on a sprayed block runs the haying gate (C-28)', () => {
  it('gates forage-family crops and a planting the body mislabels', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(3);
      m.role = 'helper';
      for (const cropPluginId of ['bmr-sorghum-sudan', 'sudangrass-piper']) {
        const cut = await post(HARVEST, '/harvest/record', {
          blockId: farm.blockId,
          cropPluginId,
          quantity: '40 bales'
        });
        expect(cut.status).toBe(422);
        expect(cut.body.code).toBe('GRAZING_UNKNOWN');
      }
      const alfalfa = createPlanned({
        blockId: farm.blockId,
        cropPluginId: 'alfalfa-vernema',
        varietyDisplayName: 'Vernema'
      });
      const mislabelled = await post(HARVEST, '/harvest/record', {
        blockId: farm.blockId,
        cropId: alfalfa.id,
        cropPluginId: 'tomato-amish-paste',
        quantity: '40 bales'
      });
      expect(mislabelled.status).toBe(400);
      expect(mislabelled.body.error).toBe('CROP_MISMATCH');
      const noPlanting = await post(HARVEST, '/harvest/record', {
        blockId: farm.blockId,
        cropPluginId: 'tomato-amish-paste',
        quantity: '40 bales'
      });
      expect(noPlanting.status).toBe(422);
      expect(noPlanting.body.code).toBe('GRAZING_UNKNOWN');
    });
  });
});

describe('round 4: a sex change and the lactating reading (C-10)', () => {
  async function eweInMilkHold() {
    const farm = sprayedPasture(5, 'review-dairy');
    const ewe = await post(CREATE, '/animals', {
      speciesId: 'sheep',
      name: 'Dot',
      sex: 'female',
      housingFieldId: farm.barnId
    });
    expect(ewe.status).toBe(201);
    const id = ewe.body.animal.id as string;
    const on = await move({
      subjectType: 'animal',
      subjectId: id,
      fieldId: farm.pastureId,
      movedAt: Date.now() - 4 * DAY
    });
    expect(on.status).toBe(201);
    const milk = await produce('animal', id, 'milk', 'food');
    expect(milk.status).toBe(422);
    expect(milk.body.code).toBe('GRAZING_INTERVAL');
    return id;
  }
  const patch = (id: string, body: unknown, locals?: Record<string, unknown>) =>
    call(PATCH_ANIMAL, `/animals/${id}`, 'PATCH', { params: { id }, body, locals });

  it('needs the interactive owner and a reason, and is audited', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const id = await eweInMilkHold();
      expect((await patch(id, { sex: 'male' })).body.code).toBe('REASON_REQUIRED');
      expect(
        (await patch(id, { sex: 'male', flagReason: 'Ram' }, { authVia: 'bearer' })).status
      ).toBe(403);
      m.impersonating = true;
      expect((await patch(id, { sex: 'male', flagReason: 'Ram' })).status).toBe(403);
      m.impersonating = false;
      // C-35: the general reading is shorter than the lactating one, so a
      // change to male while that grazing hold is on file would shorten it.
      const held = await patch(id, { sex: 'male', flagReason: 'Sexed wrong at birth' });
      expect(held.status).toBe(409);
      expect(held.body.code).toBe('HOLD_WOULD_SHORTEN');
      expect(held.body.holds.length).toBeGreaterThan(0);
      const lamb = await post(CREATE, '/animals', {
        speciesId: 'sheep',
        name: 'Pip',
        sex: 'female'
      });
      const ok = await patch(lamb.body.animal.id, {
        sex: 'male',
        flagReason: 'Sexed wrong at birth'
      });
      expect(ok.status).toBe(200);
      const changes = listFlagChanges('animal', lamb.body.animal.id);
      expect(changes.at(-1)).toMatchObject({
        flag: 'presumed_lactating',
        oldValue: true,
        newValue: false,
        reason: 'Sexed wrong at birth'
      });
    });
  });

  it('never lets milk from an animal recorded as male be food, and the stored floor still holds milk', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const id = await eweInMilkHold();
      expect((await patch(id, { sex: 'male', flagReason: 'Ram' })).status).toBe(409);
      const lamb = await post(CREATE, '/animals', {
        speciesId: 'sheep',
        name: 'Pip',
        sex: 'female'
      });
      const ram = lamb.body.animal.id as string;
      expect((await patch(ram, { sex: 'male', flagReason: 'Ram' })).status).toBe(200);
      const milk = await produce('animal', ram, 'milk', 'food');
      expect(milk.status).toBe(422);
      expect(milk.body.code).toBe('MILK_FROM_MALE');
      expect((await produce('animal', ram, 'milk', 'discard')).status).toBe(201);
      expect((await patch(ram, { sex: 'female' })).status).toBe(200);
      expect((await produce('animal', id, 'milk', 'food')).body.code).toBe('GRAZING_INTERVAL');
    });
  });
});
