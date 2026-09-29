// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({ role: 'owner' as string }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: 'gates-user', role: m.role });
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
import { animalHealthEvents, equipment, owners, users } from '$lib/db/schema';
import { runWithTenantAsync, tenantValues } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import { insertGrazingAttestation } from '$lib/db/grazingAttestations';
import { getAnimal } from '$lib/db/animals';
import { getAnimalGroup } from '$lib/db/animalGroups';
import { listCuttings } from '$lib/db/hayCuttings';
import { listLocationsForSubject } from '$lib/db/animalLocations';
import { loadTreatments } from '$lib/server/animalRecords';

import { POST as CREATE } from './+server';
import { POST as MOVE } from './move/+server';
import { POST as STATUS } from './status/+server';
import { POST as PRODUCTION } from './production/record/+server';
import { POST as CREATE_GROUP } from '../animal-groups/+server';
import { POST as HAY } from '../hay/cuttings/+server';

const DAY = 86_400_000;

function seedOwner(): string {
  const id = `gates-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: 'gates-user', email: 'gates@test.local' })
    .onConflictDoNothing()
    .run();
  return id;
}

async function call(
  handler: unknown,
  path: string,
  body: unknown
): Promise<{ status: number; body: Json }> {
  const url = new URL(`http://localhost/api${path}`);
  const res = await (handler as (e: never) => Promise<Response>)({
    params: {},
    url,
    request: new Request(url.href, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    locals: {}
  } as never);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const move = (body: unknown) => call(MOVE, '/animals/move', body);
const status = (body: unknown) => call(STATUS, '/animals/status', body);

interface Farm {
  barnId: string;
  pastureId: string;
  blockId: string;
  sprayRef: string;
}

function sprayedPasture(daysAgo = 10): Farm {
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
    performedById: 'gates-user',
    occurredAt: Date.now() - daysAgo * DAY,
    products: [{ pluginId: 'unsourced-weedkiller', chemistryClasses: ['glyphosate'] }],
    conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
    rulesVersion: 'test',
    pluginHashes: {}
  });
  return {
    barnId: barn.id,
    pastureId: pasture.id,
    blockId: block.id,
    sprayRef: `spray:${spray.id}`
  };
}

function attest(
  farm: Farm,
  graze: number | null,
  hay: number | null,
  lactating: number | null = graze
) {
  insertGrazingAttestation({
    fieldId: farm.pastureId,
    sprayEventRef: farm.sprayRef,
    productPluginId: 'unsourced-weedkiller',
    grazeDays: graze,
    hayDays: hay,
    lactatingGrazeDays: lactating,
    reason: 'Read from the label',
    attestedBy: 'gates-user'
  });
}

async function ewes(farm: Farm, headCount = 12): Promise<string> {
  const res = await call(CREATE_GROUP, '/animal-groups', {
    name: 'Ewes',
    speciesId: 'sheep',
    headCount,
    housingFieldId: farm.barnId
  });
  expect(res.status).toBe(201);
  return res.body.group.id;
}

function treat(
  subjectType: 'animal' | 'group',
  subjectId: string,
  productName: string,
  at: number
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
});

describe('grazing gate on POST /api/animals/move', () => {
  it('blocks ewes from a pasture sprayed with an unsourced product and names the owner', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture();
      const groupId = await ewes(farm);
      const res = await move({ subjectType: 'group', subjectId: groupId, fieldId: farm.pastureId });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('GRAZING_UNKNOWN');
      expect(res.body.error).toContain('North pasture was sprayed with');
      expect(res.body.error).toContain('until the owner adds the grazing time from the label');
      expect(res.body.error).not.toContain('Ask the owner');
      expect(res.body.askOwner).toBe(false);
      expect(res.body.ownerCanAttest).toBe(true);
      expect(getAnimalGroup(groupId)?.housingFieldId).toBe(farm.barnId);
    });
  });

  it('gives a helper the same stop, with "Ask the owner" and no override', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture();
      const groupId = await ewes(farm);
      m.role = 'helper';
      const res = await move({ subjectType: 'group', subjectId: groupId, fieldId: farm.pastureId });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('GRAZING_UNKNOWN');
      expect(res.body.error).toContain('Ask the owner.');
      expect(res.body.askOwner).toBe(true);
      expect(getAnimalGroup(groupId)?.housingFieldId).toBe(farm.barnId);
    });
  });

  it('clears exactly the attested interval and nothing more', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(10);
      const groupId = await ewes(farm);
      attest(farm, 14, null);
      const held = await move({
        subjectType: 'group',
        subjectId: groupId,
        fieldId: farm.pastureId
      });
      expect(held.status).toBe(422);
      expect(held.body.code).toBe('GRAZING_INTERVAL');
      expect(held.body.clearsAtMs).toBeGreaterThan(Date.now() + 3 * DAY);
      expect(held.body.error).toContain("Food animals can't go there until");
      attest(farm, 7, null);
      const stillHeld = await move({
        subjectType: 'group',
        subjectId: groupId,
        fieldId: farm.pastureId
      });
      expect(stillHeld.status).toBe(422);
    });
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(10);
      const groupId = await ewes(farm);
      attest(farm, 7, null);
      const res = await move({ subjectType: 'group', subjectId: groupId, fieldId: farm.pastureId });
      expect(res.status).toBe(201);
      expect(res.body.warnings).toEqual([]);
      expect(getAnimalGroup(groupId)?.housingFieldId).toBe(farm.pastureId);
    });
  });

  it('keeps milking animals held when the owner gives only the general grazing time', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(10);
      const groupId = await ewes(farm);
      attest(farm, 0, null, null);
      const held = await move({
        subjectType: 'group',
        subjectId: groupId,
        fieldId: farm.pastureId
      });
      expect(held.status).toBe(422);
      expect(held.body.code).toBe('GRAZING_UNKNOWN');
      attest(farm, 0, null, 3);
      const ok = await move({ subjectType: 'group', subjectId: groupId, fieldId: farm.pastureId });
      expect(ok.status).toBe(201);
    });
  });

  it('runs on group splits and on joining a group that lives on the pasture', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture();
      const groupId = await ewes(farm, 12);
      const split = await move({
        subjectType: 'group',
        subjectId: groupId,
        fieldId: farm.pastureId,
        count: 4
      });
      expect(split.status).toBe(422);
      expect(getAnimalGroup(groupId)?.headCount).toBe(12);

      const flock = await call(CREATE_GROUP, '/animal-groups', {
        name: 'Pasture flock',
        speciesId: 'sheep',
        headCount: 3
      });
      const flockId = flock.body.group.id;
      const placed = await move({
        subjectType: 'group',
        subjectId: flockId,
        fieldId: farm.pastureId,
        movedAt: Date.now() - 3 * DAY
      });
      expect(placed.status).toBe(201);
      const ram = await call(CREATE, '/animals', {
        speciesId: 'sheep',
        name: 'Ram',
        sex: 'male',
        housingFieldId: farm.barnId
      });
      const joined = await move({
        subjectType: 'animal',
        subjectId: ram.body.animal.id,
        toGroupId: flockId
      });
      expect(joined.status).toBe(422);
      expect(getAnimal(ram.body.animal.id)?.groupId).toBeNull();
    });
  });

  it('warns but allows pets, and passes Areas with nothing sprayed', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture();
      const dog = await call(CREATE, '/animals', {
        speciesId: 'dog',
        name: 'Rex',
        housingFieldId: farm.barnId
      });
      const res = await move({
        subjectType: 'animal',
        subjectId: dog.body.animal.id,
        fieldId: farm.pastureId
      });
      expect(res.status).toBe(201);
      expect(res.body.warnings[0]).toContain('not used for food');
      const groupId = await ewes(farm);
      const yard = createField({ name: 'Yard', kind: 'pasture' });
      const clear = await move({ subjectType: 'group', subjectId: groupId, fieldId: yard.id });
      expect(clear.status).toBe(201);
    });
  });

  it('saves a move that already happened and holds the meat at the table (C-30)', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(10);
      const lamb = await call(CREATE, '/animals', {
        speciesId: 'sheep',
        tag: 'L1',
        sex: 'male',
        housingFieldId: farm.barnId
      });
      const id = lamb.body.animal.id;
      const moved = await move({
        subjectType: 'animal',
        subjectId: id,
        fieldId: farm.pastureId,
        movedAt: Date.now() - 2 * DAY
      });
      expect(moved.status).toBe(201);
      expect(moved.body.warnings[0]).toContain('because it already happened');
      const slaughter = await status({
        subjectType: 'animal',
        subjectId: id,
        status: 'slaughtered'
      });
      expect(slaughter.status).toBe(422);
      expect(slaughter.body.code).toBe('GRAZING_UNKNOWN');
      expect(slaughter.body.resubmitAs).toEqual({ status: 'culled', meatUsed: false });
      expect(slaughter.body.error).toContain('record it as culled, with the meat not used');
      expect(getAnimal(id)?.status).toBe('active');
      const culled = await status({ subjectType: 'animal', subjectId: id, status: 'culled' });
      expect(culled.status).toBe(201);
    });
  });
});

describe('grazing exposure on POST /api/animals/production/record (C-30)', () => {
  it('holds milk from ewes already on a sprayed pasture, and discard always saves', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(10);
      const groupId = await ewes(farm);
      const moved = await move({
        subjectType: 'group',
        subjectId: groupId,
        fieldId: farm.pastureId,
        movedAt: Date.now() - 2 * DAY
      });
      expect(moved.status).toBe(201);
      const milk = (use: string) =>
        call(PRODUCTION, '/animals/production/record', {
          subjectType: 'group',
          subjectId: groupId,
          kind: 'milk',
          quantity: 2,
          unit: 'gal',
          use
        });
      const food = await milk('food');
      expect(food.status).toBe(422);
      expect(food.body.code).toBe('GRAZING_UNKNOWN');
      expect(food.body.resubmitAs).toBe('discard');
      expect(food.body.overridable).toBe(false);
      m.role = 'helper';
      const helper = await milk('sale');
      expect(helper.status).toBe(422);
      expect(helper.body.askOwner).toBe(true);
      expect((await milk('discard')).status).toBe(201);
    });
  });
});

describe('meat gate on POST /api/animals/status', () => {
  it('blocks slaughter while a treatment withdrawal is unknown, for owner and helper alike', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const ewe = await call(CREATE, '/animals', { speciesId: 'sheep', tag: 'E1' });
      const id = ewe.body.animal.id;
      treat('animal', id, 'Mystery drench', Date.now() - DAY);
      const owner = await status({ subjectType: 'animal', subjectId: id, status: 'slaughtered' });
      expect(owner.status).toBe(422);
      expect(owner.body.code).toBe('WITHDRAWAL_UNKNOWN');
      expect(owner.body.askOwner).toBe(false);
      m.role = 'helper';
      const helper = await status({
        subjectType: 'animal',
        subjectId: id,
        status: 'sold-for-meat'
      });
      expect(helper.status).toBe(422);
      expect(helper.body.error).toContain('Ask the owner');
      expect(helper.body.askOwner).toBe(true);
      const usedMeat = await status({
        subjectType: 'animal',
        subjectId: id,
        status: 'culled',
        meatUsed: true
      });
      expect(usedMeat.status).toBe(422);
      expect(getAnimal(id)?.status).toBe('active');
      const died = await status({ subjectType: 'animal', subjectId: id, status: 'died' });
      expect(died.status).toBe(201);
    });
  });

  it('blocks a prohibited drug forever, whatever the food flag says', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const ewe = await call(CREATE, '/animals', { speciesId: 'sheep', tag: 'E2' });
      const id = ewe.body.animal.id;
      treat('animal', id, 'Chloramphenicol ointment', Date.now() - 900 * DAY);
      const res = await status({ subjectType: 'animal', subjectId: id, status: 'slaughtered' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PROHIBITED_DRUG');
      expect(res.body.clearsAtMs).toBeNull();
    });
  });

  it('holds a group slaughter after a group treatment', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const flock = await call(CREATE_GROUP, '/animal-groups', {
        name: 'Broilers',
        speciesId: 'chicken',
        headCount: 20
      });
      const groupId = flock.body.group.id;
      treat('group', groupId, 'Unknown coccidiostat', Date.now() - DAY);
      const res = await status({
        subjectType: 'group',
        subjectId: groupId,
        status: 'slaughtered',
        headCountDelta: -20
      });
      expect(res.status).toBe(422);
      expect(getAnimalGroup(groupId)?.headCount).toBe(20);
      const discard = await status({
        subjectType: 'group',
        subjectId: groupId,
        status: 'culled',
        headCountDelta: -20
      });
      expect(discard.status).toBe(201);
    });
  });

  it('never blocks a treatment on another animal', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const a = await call(CREATE, '/animals', { speciesId: 'sheep', tag: 'A' });
      const b = await call(CREATE, '/animals', { speciesId: 'sheep', tag: 'B' });
      treat('animal', a.body.animal.id, 'Mystery drench', Date.now() - DAY);
      const res = await status({
        subjectType: 'animal',
        subjectId: b.body.animal.id,
        status: 'slaughtered'
      });
      expect(res.status).toBe(201);
    });
  });
});

describe('tenant scope of the gate reads', () => {
  it("never reads another Owner's group changes or treatments", async () => {
    const a = seedOwner();
    const b = seedOwner();
    let hen = '';
    await runWithTenantAsync(a, async () => {
      const coop = createField({ name: 'Coop', kind: 'barn' });
      const yard = createField({ name: 'Yard', kind: 'barn' });
      const flock = await call(CREATE_GROUP, '/animal-groups', {
        name: 'Hens',
        speciesId: 'chicken',
        headCount: 3,
        members: [{ name: 'Pearl' }],
        housingFieldId: coop.id
      });
      const henId = flock.body.members[0].id;
      const out = await move({ subjectType: 'animal', subjectId: henId, fieldId: yard.id });
      expect(out.status).toBe(201);
      treat('animal', henId, 'Mystery drench', Date.now() - DAY);
      hen = henId;
      expect(listLocationsForSubject('animal', henId).some((r) => r.fromGroupId)).toBe(true);
      expect(loadTreatments([{ subjectType: 'animal', subjectId: henId }])).toHaveLength(1);
    });
    await runWithTenantAsync(b, async () => {
      expect(listLocationsForSubject('animal', hen)).toEqual([]);
      expect(loadTreatments([{ subjectType: 'animal', subjectId: hen }])).toEqual([]);
    });
  });
});

describe('hay gate on POST /api/hay/cuttings (C-28)', () => {
  it('blocks mowing a sprayed block with no haying time on file, even with the weather override', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture(10);
      const res = await call(HAY, '/hay/cuttings', {
        blockId: farm.blockId,
        cropPluginId: 'alfalfa-vernema',
        overrideMowGate: true
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('GRAZING_UNKNOWN');
      expect(res.body.error).toContain('haying time is not on file');
      expect(listCuttings({ blockId: farm.blockId })).toEqual([]);
      attest(farm, null, 5);
      const cut = await call(HAY, '/hay/cuttings', {
        blockId: farm.blockId,
        cropPluginId: 'alfalfa-vernema'
      });
      expect(cut.status).toBe(201);
    });
  });
});
