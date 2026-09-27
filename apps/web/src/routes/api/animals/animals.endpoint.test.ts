// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({ role: 'owner' as string }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: 'animals-user', role: m.role });
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
    chicken: { pluginId: 'chicken', displayName: 'Chicken', foodProducingDefault: true },
    duck: { pluginId: 'duck', displayName: 'Duck', foodProducingDefault: true },
    sheep: { pluginId: 'sheep', displayName: 'Sheep', foodProducingDefault: true },
    dog: { pluginId: 'dog', displayName: 'Dog', foodProducingDefault: false },
    horse: {
      pluginId: 'horse',
      displayName: 'Horse',
      foodProducingDefault: true,
      notForSlaughterToggle: true
    }
  };
  return {
    ...actual,
    getDataKinds: async () => ({
      species: { get: (id: string) => species[id] },
      animalHealth: { get: () => undefined }
    })
  };
});

import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { animalFlagChanges, animalLocations, owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, withTenant } from '$lib/db/tenant';
import { createField, type Field } from '$lib/db/fields';
import { areaCapacity } from '$lib/server/animals';
import { createCloseout } from '$lib/db/seasonCloseouts';
import { seasonYearOf } from '$lib/server/seasonClose';
import { getAnimal } from '$lib/db/animals';
import { getAnimalGroup } from '$lib/db/animalGroups';
import {
  currentHousing,
  listLocationsForSubject,
  listLocationsOnField
} from '$lib/db/animalLocations';
import { evaluateStatusLock, listStatusEvents } from '$lib/db/animalStatus';
import { storageUsage, refreshStorageUsage } from '$lib/server/storageUsage';
import { openStay, isNonOverlapping } from '$lib/animals/timeline';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { fakeJpeg, toDataUrl } from '$lib/journal/jpegFixture';
import { LOCK_WINDOW_MS } from '$lib/db/recordKinds';
import { RULES_VERSION } from '$lib/safety/version';

import { GET as LIST, POST as CREATE } from './+server';
import { GET as GET_ONE, PATCH, DELETE } from './[id]/+server';
import { GET as PHOTO } from './[id]/photo/+server';
import { POST as MOVE } from './move/+server';
import { POST as STATUS } from './status/+server';
import { DELETE as UNDO_STATUS } from './status/[id]/+server';
import { DELETE as UNDO_MOVE } from './locations/[id]/+server';
import { GET as LIST_GROUPS, POST as CREATE_GROUP } from '../animal-groups/+server';
import {
  GET as GET_GROUP,
  PATCH as PATCH_GROUP,
  DELETE as DELETE_GROUP
} from '../animal-groups/[id]/+server';
import { DELETE as DELETE_FIELD, PATCH as PATCH_FIELD } from '../fields/[id]/+server';
import fc from 'fast-check';

function seedOwner(): string {
  const id = `animals-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: 'animals-user', email: 'animals@test.local' })
    .onConflictDoNothing()
    .run();
  return id;
}

function req(url: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const BASE = 'http://localhost/api';
type Handler = (event: never) => Response | Promise<Response>;

async function call(
  handler: unknown,
  path: string,
  method: string,
  opts: { params?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = new URL(`${BASE}${path}`);
  try {
    const res = await (handler as Handler)({
      params: opts.params ?? {},
      url,
      request: req(url.href, method, opts.body, opts.headers),
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const create = (body: unknown) => call(CREATE, '/animals', 'POST', { body });
const createGroup = (body: unknown) => call(CREATE_GROUP, '/animal-groups', 'POST', { body });
const move = (body: unknown, headers?: Record<string, string>) =>
  call(MOVE, '/animals/move', 'POST', { body, headers });
const status = (body: unknown) => call(STATUS, '/animals/status', 'POST', { body });
const patch = (id: string, body: unknown) =>
  call(PATCH, `/animals/${id}`, 'PATCH', { params: { id }, body });
const patchGroup = (id: string, body: unknown) =>
  call(PATCH_GROUP, `/animal-groups/${id}`, 'PATCH', { params: { id }, body });

function pasture(name = 'North pasture') {
  return createField({ name, kind: 'pasture' });
}

/** The housing cache must equal the open stay (or the group's, for a
 *  grouped individual). */
function expectCacheMatchesTimeline(subjectType: 'animal' | 'group', id: string) {
  const stays = listLocationsForSubject(subjectType, id);
  expect(isNonOverlapping(stays)).toBe(true);
  if (subjectType === 'group') {
    expect(getAnimalGroup(id)?.housingFieldId ?? null).toBe(openStay(stays)?.fieldId ?? null);
    return;
  }
  const animal = getAnimal(id)!;
  expect(animal.housingFieldId).toBe(currentHousing({ subjectType, subjectId: id }));
  if (!animal.groupId && animal.status === 'active') {
    expect(animal.housingFieldId).toBe(openStay(stays)?.fieldId ?? null);
  }
}

beforeEach(() => {
  m.role = 'owner';
});

describe('creating animals and groups', () => {
  it('adds a flock of 24 layers to a coop with the species food flag', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const coop = createField({ name: 'Coop', kind: 'barn' });
      const res = await createGroup({
        name: 'Layers',
        speciesId: 'chicken',
        headCount: 24,
        housingFieldId: coop.id
      });
      expect(res.status).toBe(201);
      const group = (res.body as Json).group;
      expect(group).toMatchObject({ headCount: 24, foodProducing: true, purpose: 'production' });
      expectCacheMatchesTimeline('group', group.id);
      const listed = (await call(LIST_GROUPS, '/animal-groups', 'GET')).body as Json;
      expect(listed.groups[0]).toMatchObject({ id: group.id, total: 24, namedCount: 0 });
    });
  });

  it('turns named members into animal rows taken off the unnamed count', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const res = await createGroup({
        name: 'Backyard hens',
        speciesId: 'chicken',
        headCount: 4,
        members: [{ name: 'Henrietta' }, { name: 'Pearl', sex: 'female' }]
      });
      const body = res.body as Json;
      expect(body.group.headCount).toBe(2);
      expect(body.members).toHaveLength(2);
      const detail = (
        await call(GET_GROUP, `/animal-groups/${body.group.id}`, 'GET', {
          params: { id: body.group.id }
        })
      ).body as Json;
      expect(detail.group.total).toBe(4);
      expect(detail.members.map((a: Json) => a.name).sort()).toEqual(['Henrietta', 'Pearl']);
    });
  });

  it('defaults a dog to a pet that is not food-producing, and a horse to food-producing', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const house = createField({ name: 'House', kind: 'residence' });
      const dog = (await create({ speciesId: 'dog', name: 'Rex', housingFieldId: house.id }))
        .body as Json;
      expect(dog.animal).toMatchObject({ foodProducing: false, purpose: 'pet' });
      expectCacheMatchesTimeline('animal', dog.animal.id);
      const cat = await create({ speciesId: 'dog', name: 'Mo' });
      expect((cat.body as Json).animal.housingFieldId).toBeNull();
      const horse = (await create({ speciesId: 'horse', name: 'Blaze' })).body as Json;
      expect(horse.animal.foodProducing).toBe(true);
    });
  });

  it('refuses a missing identifier, an unknown species and a non-housing Area', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      expect((await create({ speciesId: 'dog' })).status).toBe(400);
      expect((await create({ speciesId: 'alpaca', name: 'Al' })).status).toBe(400);
      const pond = createField({ name: 'Pond', kind: 'water' });
      const res = await create({ speciesId: 'duck', name: 'Quack', housingFieldId: pond.id });
      expect(res.status).toBe(400);
      expect((res.body as Json).code).toBe('NOT_A_HOUSING_AREA');
    });
  });

  it('keeps one species per group', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = (await createGroup({ name: 'Flock', speciesId: 'chicken', headCount: 3 }))
        .body as Json;
      const res = await create({ speciesId: 'duck', name: 'Dot', groupId: g.group.id });
      expect(res.status).toBe(409);
      expect((res.body as Json).code).toBe('SPECIES_MISMATCH');
    });
  });

  it('warns but saves when a tag is already in use', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      await create({ speciesId: 'sheep', name: 'Daisy', tag: '14' });
      const res = await create({ speciesId: 'sheep', tag: '14' });
      expect(res.status).toBe(201);
      expect((res.body as Json).warnings[0]).toMatchObject({
        code: 'TAG_IN_USE',
        message: 'Tag 14 is already used by Daisy.'
      });
    });
  });
});

describe('authz (Q11)', () => {
  it('gives helpers 403 on create, archive, delete and food flag changes, and lets them move', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const field = pasture();
      const barn = createField({ name: 'Barn', kind: 'barn' });
      const ewe = (await create({ speciesId: 'sheep', tag: '1', housingFieldId: field.id }))
        .body as Json;
      const g = (await createGroup({ name: 'Ewes', speciesId: 'sheep', headCount: 12 }))
        .body as Json;
      m.role = 'helper';
      expect((await create({ speciesId: 'sheep', tag: '2' })).status).toBe(403);
      expect((await createGroup({ name: 'X', speciesId: 'sheep', headCount: 1 })).status).toBe(403);
      expect((await patch(ewe.animal.id, { status: 'archived' })).status).toBe(403);
      expect((await patch(ewe.animal.id, { foodProducing: false, flagReason: 'pet' })).status).toBe(
        403
      );
      expect(
        (await patchGroup(g.group.id, { foodProducing: false, flagReason: 'pets' })).status
      ).toBe(403);
      expect(
        (
          await call(DELETE, `/animals/${ewe.animal.id}`, 'DELETE', {
            params: { id: ewe.animal.id }
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(DELETE_GROUP, `/animal-groups/${g.group.id}`, 'DELETE', {
            params: { id: g.group.id }
          })
        ).status
      ).toBe(403);
      const moved = await move({
        subjectType: 'animal',
        subjectId: ewe.animal.id,
        fieldId: barn.id
      });
      expect(moved.status).toBe(201);
      const photo = toDataUrl(fakeJpeg({ exif: false }));
      expect((await patch(ewe.animal.id, { photo })).status).toBe(200);
      m.role = 'inspector';
      expect(
        (await move({ subjectType: 'animal', subjectId: ewe.animal.id, fieldId: field.id })).status
      ).toBe(403);
    });
  });
});

describe('food-producing flag', () => {
  it('writes an audit row with the change in the same save', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const hen = (await create({ speciesId: 'chicken', name: 'Old Bess' })).body as Json;
      const res = await patch(hen.animal.id, {
        foodProducing: false,
        flagReason: 'Retired, eggs not eaten'
      });
      expect(res.status).toBe(200);
      expect((res.body as Json).animal.foodProducing).toBe(false);
      const rows = db
        .select()
        .from(animalFlagChanges)
        .where(withTenant(animalFlagChanges, eq(animalFlagChanges.subjectId, hen.animal.id)))
        .all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        flag: 'food_producing',
        oldValue: true,
        newValue: false,
        changedBy: 'animals-user'
      });
    });
  });

  it('offers not for slaughter only where the species does, and never flips food_producing', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const horse = (await create({ speciesId: 'horse', name: 'Blaze' })).body as Json;
      const res = await patch(horse.animal.id, {
        notForSlaughter: true,
        flagReason: 'Given a drug not allowed in food animals'
      });
      expect((res.body as Json).animal).toMatchObject({
        notForSlaughter: true,
        foodProducing: true
      });
      const ewe = (await create({ speciesId: 'sheep', tag: '9' })).body as Json;
      const refused = await patch(ewe.animal.id, { notForSlaughter: true, flagReason: 'x' });
      expect(refused.status).toBe(400);
    });
  });

  it('reads a group as food-producing when any active member is', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = (
        await createGroup({
          name: 'Mixed pets',
          speciesId: 'chicken',
          headCount: 2,
          members: [{ name: 'Nugget' }]
        })
      ).body as Json;
      await patchGroup(g.group.id, { foodProducing: false, flagReason: 'Pet hens' });
      const detail = (
        await call(GET_GROUP, `/animal-groups/${g.group.id}`, 'GET', {
          params: { id: g.group.id }
        })
      ).body as Json;
      expect(detail.group.foodProducing).toBe(false);
      expect(detail.group.effectiveFoodProducing).toBe(true);
      expect(detail.flagChanges).toHaveLength(1);
    });
  });
});

describe('moves', () => {
  it('moves a whole flock with one stay and members follow', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const coop = createField({ name: 'Coop', kind: 'barn' });
      const orchard = createField({ name: 'Orchard', kind: 'orchard' });
      const g = (
        await createGroup({
          name: 'Layers',
          speciesId: 'chicken',
          headCount: 24,
          housingFieldId: coop.id,
          members: [{ name: 'Henrietta' }]
        })
      ).body as Json;
      const res = await move({ subjectType: 'group', subjectId: g.group.id, fieldId: orchard.id });
      expect(res.status).toBe(201);
      expect(listLocationsForSubject('group', g.group.id)).toHaveLength(2);
      expectCacheMatchesTimeline('group', g.group.id);
      const hen = g.members[0].id;
      expect(listLocationsForSubject('animal', hen)).toHaveLength(0);
      expect(getAnimal(hen)?.housingFieldId).toBe(orchard.id);
      expectCacheMatchesTimeline('animal', hen);
      const again = await move({
        subjectType: 'group',
        subjectId: g.group.id,
        fieldId: orchard.id
      });
      expect((again.body as Json).code).toBe('ALREADY_THERE');
    });
  });

  it('splits part of a flock into a new group in one save', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const coop = createField({ name: 'Coop', kind: 'barn' });
      const broody = createField({ name: 'Broody pen', kind: 'barn' });
      const g = (
        await createGroup({
          name: 'Layers',
          speciesId: 'chicken',
          headCount: 24,
          housingFieldId: coop.id,
          members: [{ name: 'Henrietta' }, { name: 'Pearl' }]
        })
      ).body as Json;
      const henrietta = g.members.find((a: Json) => a.name === 'Henrietta').id;
      m.role = 'helper';
      const res = await move({
        subjectType: 'group',
        subjectId: g.group.id,
        fieldId: broody.id,
        count: 4,
        animalIds: [henrietta]
      });
      expect(res.status).toBe(201);
      const newGroup = (res.body as Json).move.newGroup;
      expect(newGroup).toMatchObject({
        headCount: 4,
        speciesId: 'chicken',
        foodProducing: true,
        housingFieldId: broody.id,
        name: 'Layers (5)'
      });
      expect(getAnimalGroup(g.group.id)?.headCount).toBe(18);
      expect(getAnimal(henrietta)).toMatchObject({
        groupId: newGroup.id,
        housingFieldId: broody.id
      });
      const first = listLocationsForSubject('group', newGroup.id);
      expect(first).toHaveLength(1);
      expect(first[0].fromGroupId).toBe(g.group.id);
      const marker = listLocationsForSubject('animal', henrietta);
      expect(marker[0]).toMatchObject({ fromGroupId: g.group.id, toGroupId: newGroup.id });
      expectCacheMatchesTimeline('group', newGroup.id);
      expectCacheMatchesTimeline('group', g.group.id);

      const tooMany = await move({
        subjectType: 'group',
        subjectId: g.group.id,
        fieldId: broody.id,
        count: 19
      });
      expect((tooMany.body as Json).code).toBe('COUNT_TOO_HIGH');
    });
  });

  it('takes a hen out of the flock to her own pen and back into it', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const coop = createField({ name: 'Coop', kind: 'barn' });
      const pen = createField({ name: 'Hospital pen', kind: 'barn' });
      const g = (
        await createGroup({
          name: 'Layers',
          speciesId: 'chicken',
          headCount: 3,
          housingFieldId: coop.id,
          members: [{ name: 'Pearl' }]
        })
      ).body as Json;
      const pearl = g.members[0].id;
      const t0 = Date.now();
      const out = await move({
        subjectType: 'animal',
        subjectId: pearl,
        fieldId: pen.id,
        movedAt: t0
      });
      expect(out.status).toBe(201);
      expect(getAnimal(pearl)).toMatchObject({ groupId: null, housingFieldId: pen.id });
      expect(listLocationsForSubject('animal', pearl)[0]).toMatchObject({
        fromGroupId: g.group.id,
        toMs: null
      });
      const back = await move({ subjectType: 'animal', subjectId: pearl, toGroupId: g.group.id });
      expect(back.status).toBe(201);
      const stays = listLocationsForSubject('animal', pearl);
      expect(stays[0]).toMatchObject({ toGroupId: g.group.id });
      expect(stays[0].toMs).not.toBeNull();
      expect(getAnimal(pearl)).toMatchObject({ groupId: g.group.id, housingFieldId: coop.id });
      expectCacheMatchesTimeline('animal', pearl);
    });
  });

  it('slots backdated and out-of-order moves into a non-overlapping timeline', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const fields = [pasture('A'), pasture('B'), pasture('C')];
      const ewes = (await createGroup({ name: 'Ewes', speciesId: 'sheep', headCount: 12 }))
        .body as Json;
      const now = Date.now();
      const t = [now - 5 * 3600_000, now - 3 * 3600_000, now - 4 * 3600_000];
      await move({
        subjectType: 'group',
        subjectId: ewes.group.id,
        fieldId: fields[0].id,
        movedAt: t[0]
      });
      await move({
        subjectType: 'group',
        subjectId: ewes.group.id,
        fieldId: fields[1].id,
        movedAt: t[1]
      });
      const late = await move({
        subjectType: 'group',
        subjectId: ewes.group.id,
        fieldId: fields[2].id,
        movedAt: t[2]
      });
      expect(late.status).toBe(201);
      const stays = listLocationsForSubject('group', ewes.group.id);
      expect(stays.map((s) => s.fieldId)).toEqual([fields[0].id, fields[2].id, fields[1].id]);
      expect(stays.map((s) => s.toMs)).toEqual([t[2], t[1], null]);
      expectCacheMatchesTimeline('group', ewes.group.id);
      const same = await move({
        subjectType: 'group',
        subjectId: ewes.group.id,
        fieldId: fields[0].id,
        movedAt: t[1]
      });
      expect((same.body as Json).code).toBe('SAME_TIME');
      const future = await move({
        subjectType: 'group',
        subjectId: ewes.group.id,
        fieldId: fields[0].id,
        movedAt: now + 3600_000
      });
      expect(future.status).toBe(400);
    });
  });

  it('replays a queued move exactly once', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const coop = createField({ name: 'Coop', kind: 'barn' });
      const yard = createField({ name: 'Yard', kind: 'pasture' });
      const g = (
        await createGroup({
          name: 'Layers',
          speciesId: 'chicken',
          headCount: 24,
          housingFieldId: coop.id
        })
      ).body as Json;
      m.role = 'helper';
      const headers = { [CLIENT_RECORD_HEADER]: `queue-${randomUUID()}` };
      const payload = { subjectType: 'group', subjectId: g.group.id, fieldId: yard.id };
      const first = await move(payload, headers);
      const second = await move(payload, headers);
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ ok: true, duplicate: true });
      const stays = listLocationsForSubject('group', g.group.id);
      expect(stays).toHaveLength(2);
      expect(stays[1].clientRecordId).toBe(headers[CLIENT_RECORD_HEADER]);
    });
  });

  it('refuses a move to an Area kind animals cannot live on', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = (await createGroup({ name: 'Ewes', speciesId: 'sheep', headCount: 3 }))
        .body as Json;
      const woods = createField({ name: 'Woods', kind: 'natural_area' });
      const res = await move({ subjectType: 'group', subjectId: g.group.id, fieldId: woods.id });
      expect((res.body as Json).code).toBe('NOT_A_HOUSING_AREA');
    });
  });

  it("rejects another Owner's Area, subject or group, and names an unknown subject clearly", async () => {
    const other = seedOwner();
    const theirs = await runWithTenantAsync(other, async () => {
      const f = pasture('Theirs');
      const g = (await createGroup({ name: 'Theirs', speciesId: 'sheep', headCount: 2 }))
        .body as Json;
      return { fieldId: f.id, groupId: g.group.id };
    });
    await runWithTenantAsync(seedOwner(), async () => {
      const mine = pasture('Mine');
      const g = (await createGroup({ name: 'Mine', speciesId: 'sheep', headCount: 2 }))
        .body as Json;
      const ewe = (await create({ speciesId: 'sheep', tag: '3' })).body as Json;
      const field = await move({
        subjectType: 'group',
        subjectId: g.group.id,
        fieldId: theirs.fieldId
      });
      expect(field).toMatchObject({ status: 400, body: { error: 'unknown fieldId' } });
      const subject = await move({
        subjectType: 'group',
        subjectId: theirs.groupId,
        fieldId: mine.id
      });
      expect(subject.status).toBe(400);
      expect((subject.body as Json).code).toBe('UNKNOWN_SUBJECT');
      expect((subject.body as Json).error).toMatch(/not on this farm/);
      const join = await move({
        subjectType: 'animal',
        subjectId: ewe.animal.id,
        toGroupId: theirs.groupId
      });
      expect(join).toMatchObject({ status: 400, body: { error: 'unknown toGroupId' } });
      const created = await create({
        speciesId: 'sheep',
        tag: '4',
        housingFieldId: theirs.fieldId
      });
      expect(created.status).toBe(400);
    });
  });

  it('shows over capacity on a coop without blocking the move', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const coop = createField({ name: 'Small coop', kind: 'barn' });
      const g = (await createGroup({ name: 'Layers', speciesId: 'chicken', headCount: 26 }))
        .body as Json;
      const res = await move({ subjectType: 'group', subjectId: g.group.id, fieldId: coop.id });
      expect(res.status).toBe(201);
      expect((res.body as Json).move.capacity).toBeNull();
      // coop_pen and its details schema land with B4; the capacity read only
      // needs the kind and details on the Area it is handed.
      const asCoop = { ...coop, kind: 'coop_pen', details: { capacity: 24 } } as unknown as Field;
      expect(areaCapacity(asCoop)).toEqual({ capacity: 24, count: 26, over: true });
      expect(areaCapacity({ ...asCoop, details: null })).toBeNull();
      expect(areaCapacity(coop)).toBeNull();
    });
  });

  it('lets the owner undo only the latest move, reopening the stay before it', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const [a, b] = [pasture('A'), pasture('B')];
      const g = (
        await createGroup({ name: 'Ewes', speciesId: 'sheep', headCount: 12, housingFieldId: a.id })
      ).body as Json;
      const res = (await move({ subjectType: 'group', subjectId: g.group.id, fieldId: b.id }))
        .body as Json;
      const firstStay = listLocationsForSubject('group', g.group.id)[0];
      expect(
        (
          await call(UNDO_MOVE, `/animals/locations/${firstStay.id}`, 'DELETE', {
            params: { id: firstStay.id }
          })
        ).body
      ).toMatchObject({ code: 'NOT_LATEST' });
      m.role = 'helper';
      expect(
        (
          await call(UNDO_MOVE, '/animals/locations/x', 'DELETE', {
            params: { id: res.move.location.id }
          })
        ).status
      ).toBe(403);
      m.role = 'owner';
      const undone = await call(UNDO_MOVE, '/animals/locations/x', 'DELETE', {
        params: { id: res.move.location.id }
      });
      expect(undone.status).toBe(200);
      const stays = listLocationsForSubject('group', g.group.id);
      expect(stays).toHaveLength(1);
      expect(stays[0].toMs).toBeNull();
      expect(getAnimalGroup(g.group.id)?.housingFieldId).toBe(a.id);
    });
  });
});

describe('status changes', () => {
  it('records group losses with a negative delta and offers to archive at zero', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = (await createGroup({ name: 'Broilers', speciesId: 'chicken', headCount: 3 }))
        .body as Json;
      m.role = 'helper';
      const died = await status({
        subjectType: 'group',
        subjectId: g.group.id,
        status: 'died',
        headCountDelta: -2,
        reason: 'Fox'
      });
      expect(died.status).toBe(201);
      expect((died.body as Json).emptied).toBe(false);
      expect(getAnimalGroup(g.group.id)?.headCount).toBe(1);
      const tooMany = await status({
        subjectType: 'group',
        subjectId: g.group.id,
        status: 'sold',
        headCountDelta: -2
      });
      expect((tooMany.body as Json).code).toBe('COUNT_TOO_HIGH');
      const last = await status({
        subjectType: 'group',
        subjectId: g.group.id,
        status: 'rehomed',
        headCountDelta: -1
      });
      expect((last.body as Json).emptied).toBe(true);
      expect(getAnimalGroup(g.group.id)?.status).toBe('active');
    });
  });

  it('writes a positive status event when the owner edits the count', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = (await createGroup({ name: 'Layers', speciesId: 'chicken', headCount: 10 }))
        .body as Json;
      await patchGroup(g.group.id, { headCount: 16, countReason: 'Hatched' });
      const events = listStatusEvents('group', g.group.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ status: 'active', headCountDelta: 6, reason: 'Hatched' });
    });
  });

  it('refuses a lower count through an edit; losses are outcomes (B-09)', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = (await createGroup({ name: 'Layers', speciesId: 'chicken', headCount: 10 }))
        .body as Json;
      const res = await patchGroup(g.group.id, { headCount: 7, countReason: 'Miscounted' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'USE_STATUS_FOR_LOSSES' });
      expect(getAnimalGroup(g.group.id)?.headCount).toBe(10);
      expect(listStatusEvents('group', g.group.id)).toEqual([]);
    });
  });

  it('records a slaughter with no treatment or sprayed pasture on record (32C gate passes)', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const wether = (await create({ speciesId: 'sheep', tag: '7' })).body as Json;
      const res = await status({
        subjectType: 'animal',
        subjectId: wether.animal.id,
        status: 'slaughtered'
      });
      expect(res.status).toBe(201);
      expect(getAnimal(wether.animal.id)?.status).toBe('slaughtered');
      expect(listStatusEvents('animal', wether.animal.id)[0].rulesVersion).toBe(RULES_VERSION);
      const ewe = (await create({ speciesId: 'sheep', tag: '8' })).body as Json;
      const sold = await status({
        subjectType: 'animal',
        subjectId: ewe.animal.id,
        status: 'sold-for-meat'
      });
      expect(sold.status).toBe(201);
      expect(getAnimal(ewe.animal.id)?.status).toBe('sold');
    });
  });

  it('moves a sold animal to "no longer here", closes its stay and makes it read-only', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const field = pasture();
      const ram = (await create({ speciesId: 'sheep', name: 'Ram', housingFieldId: field.id }))
        .body as Json;
      const sold = await status({
        subjectType: 'animal',
        subjectId: ram.animal.id,
        status: 'sold',
        reason: 'To a neighbour'
      });
      expect(sold.status).toBe(201);
      const after = getAnimal(ram.animal.id)!;
      expect(after).toMatchObject({
        status: 'sold',
        housingFieldId: null,
        statusReason: 'To a neighbour'
      });
      expect(openStay(listLocationsForSubject('animal', ram.animal.id))).toBeUndefined();
      const gone = (await call(LIST, '/animals?status=gone', 'GET')).body as Json;
      expect(gone.animals.map((a: Json) => a.id)).toContain(ram.animal.id);
      expect((await patch(ram.animal.id, { name: 'Other' })).body).toMatchObject({
        code: 'READ_ONLY'
      });
      expect((await patch(ram.animal.id, { notes: 'Went to the Smiths' })).status).toBe(200);
      const again = await move({
        subjectType: 'animal',
        subjectId: ram.animal.id,
        fieldId: field.id
      });
      expect((again.body as Json).code).toBe('NOT_ACTIVE');
    });
  });

  it('lets the owner undo a mistaken death inside the lock window and reopens the stay', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const field = pasture();
      const ewe = (await create({ speciesId: 'sheep', name: 'Dolly', housingFieldId: field.id }))
        .body as Json;
      const died = (
        await status({ subjectType: 'animal', subjectId: ewe.animal.id, status: 'died' })
      ).body as Json;
      m.role = 'helper';
      expect(
        (
          await call(UNDO_STATUS, '/animals/status/x', 'DELETE', {
            params: { id: died.event.id }
          })
        ).status
      ).toBe(403);
      m.role = 'owner';
      const undone = await call(UNDO_STATUS, '/animals/status/x', 'DELETE', {
        params: { id: died.event.id }
      });
      expect(undone.status).toBe(200);
      expect(getAnimal(ewe.animal.id)).toMatchObject({
        status: 'active',
        housingFieldId: field.id
      });
      expectCacheMatchesTimeline('animal', ewe.animal.id);
    });
  });

  it('locks a food-producing subject status change after 48 hours; a pet stays editable', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const ewe = (await create({ speciesId: 'sheep', tag: '5' })).body as Json;
      const dog = (await create({ speciesId: 'dog', name: 'Rex' })).body as Json;
      const old = Date.now() - LOCK_WINDOW_MS - 60_000;
      const eweDied = (
        await status({
          subjectType: 'animal',
          subjectId: ewe.animal.id,
          status: 'died',
          occurredAt: old
        })
      ).body as Json;
      const dogRehomed = (
        await status({
          subjectType: 'animal',
          subjectId: dog.animal.id,
          status: 'rehomed',
          occurredAt: old
        })
      ).body as Json;
      const locked = await call(UNDO_STATUS, '/animals/status/x', 'DELETE', {
        params: { id: eweDied.event.id }
      });
      expect(locked.body).toMatchObject({ code: 'RECORD_LOCKED' });
      const detail = (
        await call(GET_ONE, `/animals/${ewe.animal.id}`, 'GET', { params: { id: ewe.animal.id } })
      ).body as Json;
      expect(detail.statusEvents[0]).toMatchObject({ locked: true });
      expect(detail.statusEvents[0].lockedAt).toBe(old + LOCK_WINDOW_MS);
      expect(
        evaluateStatusLock(listStatusEvents('animal', dog.animal.id)[0], false)
      ).toBeUndefined();
      const petUndo = await call(UNDO_STATUS, '/animals/status/x', 'DELETE', {
        params: { id: dogRehomed.event.id }
      });
      expect(petUndo.status).toBe(200);
    });
  });

  it('corrects an older status by recording active', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = (
        await createGroup({
          name: 'Hens',
          speciesId: 'chicken',
          headCount: 2,
          members: [{ name: 'Lou' }]
        })
      ).body as Json;
      const lou = g.members[0].id;
      await status({ subjectType: 'animal', subjectId: lou, status: 'died' });
      expect(getAnimal(lou)?.housingFieldId).toBeNull();
      const back = await status({
        subjectType: 'animal',
        subjectId: lou,
        status: 'active',
        reason: 'Found her in the hedge'
      });
      expect(back.status).toBe(201);
      expect(getAnimal(lou)?.status).toBe('active');
      expect(
        (await status({ subjectType: 'animal', subjectId: lou, status: 'active' })).body
      ).toMatchObject({ code: 'ALREADY_ACTIVE' });
    });
  });
});

describe('SEASON_CLOSED never gates animals (Q10)', () => {
  it('keeps create, move and status open in a closed season', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      createCloseout({ year: seasonYearOf(Date.now()), snapshotJson: '{}' });
      const field = pasture();
      const g = await createGroup({ name: 'Ewes', speciesId: 'sheep', headCount: 5 });
      expect(g.status).toBe(201);
      const id = (g.body as Json).group.id;
      expect((await move({ subjectType: 'group', subjectId: id, fieldId: field.id })).status).toBe(
        201
      );
      expect(
        (await status({ subjectType: 'group', subjectId: id, status: 'died', headCountDelta: -1 }))
          .status
      ).toBe(201);
    });
  });
});

describe('archive and delete (B-11)', () => {
  it('deletes a mistaken entry with its first stay, and refuses one with records', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const field = pasture();
      const oops = (await create({ speciesId: 'sheep', tag: '99', housingFieldId: field.id }))
        .body as Json;
      const del = await call(DELETE, '/animals/x?ifEmpty=1', 'DELETE', {
        params: { id: oops.animal.id }
      });
      expect(del.status).toBe(200);
      expect(getAnimal(oops.animal.id)).toBeUndefined();
      expect(
        db
          .select()
          .from(animalLocations)
          .where(withTenant(animalLocations, eq(animalLocations.subjectId, oops.animal.id)))
          .all()
      ).toEqual([]);

      const kept = (await create({ speciesId: 'sheep', tag: '98', housingFieldId: field.id }))
        .body as Json;
      await move({ subjectType: 'animal', subjectId: kept.animal.id, fieldId: pasture('B').id });
      const refused = await call(DELETE, '/animals/x?ifEmpty=1', 'DELETE', {
        params: { id: kept.animal.id }
      });
      expect(refused.body).toMatchObject({ code: 'ANIMAL_HAS_RECORDS' });
      const archived = await patch(kept.animal.id, { status: 'archived' });
      expect((archived.body as Json).animal.status).toBe('archived');
      expect((await call(LIST, '/animals', 'GET')).body).toMatchObject({ animals: [] });
      const restored = await patch(kept.animal.id, { status: 'active' });
      expect((restored.body as Json).animal.housingFieldId).not.toBeNull();
    });
  });

  it('refuses to delete or archive a group while named animals are active in it', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = (
        await createGroup({
          name: 'Hens',
          speciesId: 'chicken',
          headCount: 2,
          members: [{ name: 'Lou' }]
        })
      ).body as Json;
      const del = await call(DELETE_GROUP, '/animal-groups/x', 'DELETE', {
        params: { id: g.group.id }
      });
      expect(del.body).toMatchObject({ code: 'GROUP_HAS_MEMBERS' });
      expect((await patchGroup(g.group.id, { status: 'archived' })).body).toMatchObject({
        code: 'GROUP_HAS_MEMBERS'
      });
      const counted = (await createGroup({ name: 'Flock', speciesId: 'chicken', headCount: 5 }))
        .body as Json;
      expect((await patchGroup(counted.group.id, { status: 'archived' })).body).toMatchObject({
        code: 'GROUP_HAS_ANIMALS'
      });
      await status({
        subjectType: 'group',
        subjectId: counted.group.id,
        status: 'sold',
        headCountDelta: -5
      });
      expect((await patchGroup(counted.group.id, { status: 'archived' })).status).toBe(200);
      const empty = (await createGroup({ name: 'Spare', speciesId: 'chicken', headCount: 1 }))
        .body as Json;
      expect(
        (await call(DELETE_GROUP, '/animal-groups/x', 'DELETE', { params: { id: empty.group.id } }))
          .status
      ).toBe(200);
    });
  });

  it('refuses to delete an Area while animals live there (B-27)', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const barn = createField({ name: 'Barn', kind: 'barn' });
      await create({ speciesId: 'horse', name: 'Blaze', housingFieldId: barn.id });
      const res = await call(DELETE_FIELD, `/fields/${barn.id}`, 'DELETE', {
        params: { id: barn.id }
      });
      expect(res.body).toMatchObject({ code: 'AREA_HAS_ANIMALS' });
      const empty = pasture('Empty');
      expect(
        (await call(DELETE_FIELD, `/fields/${empty.id}`, 'DELETE', { params: { id: empty.id } }))
          .status
      ).toBe(200);
    });
  });

  it('refuses to change an Area with animals into a kind they cannot live on (B-13)', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const coop = createField({ name: 'Coop', kind: 'coop_pen' });
      await createGroup({
        name: 'Layers',
        speciesId: 'chicken',
        headCount: 6,
        housingFieldId: coop.id
      });
      const patchField = (id: string, body: unknown) =>
        call(PATCH_FIELD, `/fields/${id}`, 'PATCH', { params: { id }, body });
      const water = await patchField(coop.id, { kind: 'water' });
      expect(water.status).toBe(409);
      expect(water.body).toMatchObject({ code: 'AREA_HAS_ANIMALS' });
      expect((await patchField(coop.id, { kind: 'barn' })).status).toBe(200);
      const empty = createField({ name: 'Old pen', kind: 'coop_pen' });
      expect((await patchField(empty.id, { kind: 'natural_area' })).status).toBe(200);
    });
  });
});

describe('photos (B-24)', () => {
  it('strips metadata, serves the JPEG and counts toward storage', async () => {
    const owner = seedOwner();
    await runWithTenantAsync(owner, async () => {
      const dog = (await create({ speciesId: 'dog', name: 'Rex' })).body as Json;
      const bad = await patch(dog.animal.id, { photo: 'data:image/png;base64,AAAA' });
      expect(bad.status).toBe(400);
      const res = await patch(dog.animal.id, { photo: toDataUrl(fakeJpeg({ exif: true })) });
      expect(res.status).toBe(200);
      expect((res.body as Json).animal.hasPhoto).toBe(true);
      const img = await (PHOTO as Handler)({ params: { id: dog.animal.id } } as never);
      expect(img.headers.get('content-type')).toBe('image/jpeg');
      const usage = refreshStorageUsage();
      expect(usage.animalPhotoBytes).toBeGreaterThan(0);
      expect(storageUsage().bytes).toBe(usage.journalPhotoBytes + usage.animalPhotoBytes);
    });
    expect(runWithTenant(seedOwner(), () => refreshStorageUsage().animalPhotoBytes)).toBe(0);
  });
});

describe('outcomes keep the location timeline coherent (B-06, B-12, B-28)', () => {
  it('"still here" puts an ungrouped animal back where it lived', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const house = createField({ name: 'House', kind: 'residence' });
      const dog = (await create({ speciesId: 'dog', name: 'Rex', housingFieldId: house.id }))
        .body as Json;
      await status({ subjectType: 'animal', subjectId: dog.animal.id, status: 'died' });
      expect(getAnimal(dog.animal.id)?.housingFieldId).toBeNull();
      const back = await status({
        subjectType: 'animal',
        subjectId: dog.animal.id,
        status: 'active',
        reason: 'Asleep under the porch'
      });
      expect(back.status).toBe(201);
      expect(getAnimal(dog.animal.id)).toMatchObject({
        status: 'active',
        housingFieldId: house.id
      });
      expectCacheMatchesTimeline('animal', dog.animal.id);
      expect(openStay(listLocationsForSubject('animal', dog.animal.id))?.fieldId).toBe(house.id);

      const undone = await call(UNDO_STATUS, '/animals/status/x', 'DELETE', {
        params: { id: (back.body as Json).event.id }
      });
      expect(undone.status).toBe(200);
      expect(getAnimal(dog.animal.id)?.status).toBe('died');
      expect(openStay(listLocationsForSubject('animal', dog.animal.id))).toBeUndefined();
    });
  });

  it('refuses an outcome dated before a later move, and undo reverses the stay it closed', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const barn = createField({ name: 'Barn', kind: 'barn' });
      const field = pasture();
      const now = Date.now();
      const sunday = now - 4 * 86_400_000;
      const monday = now - 3 * 86_400_000;
      const tuesday = now - 2 * 86_400_000;
      const ewe = (await create({ speciesId: 'sheep', name: 'Dolly' })).body as Json;
      await move({
        subjectType: 'animal',
        subjectId: ewe.animal.id,
        fieldId: barn.id,
        movedAt: sunday
      });
      await move({
        subjectType: 'animal',
        subjectId: ewe.animal.id,
        fieldId: field.id,
        movedAt: tuesday
      });
      const early = await status({
        subjectType: 'animal',
        subjectId: ewe.animal.id,
        status: 'died',
        occurredAt: monday
      });
      expect(early.status).toBe(409);
      expect(early.body).toMatchObject({ code: 'OUT_OF_ORDER' });
      const atMove = await status({
        subjectType: 'animal',
        subjectId: ewe.animal.id,
        status: 'died',
        occurredAt: tuesday
      });
      expect(atMove.body).toMatchObject({ code: 'OUT_OF_ORDER' });
      expect(getAnimal(ewe.animal.id)?.status).toBe('active');
      expect(listStatusEvents('animal', ewe.animal.id)).toEqual([]);

      const died = await status({
        subjectType: 'animal',
        subjectId: ewe.animal.id,
        status: 'died',
        occurredAt: tuesday + 3600_000
      });
      expect(died.status).toBe(201);
      expect(listLocationsOnField(field.id, { openOnly: true })).toEqual([]);
      await call(UNDO_STATUS, '/animals/status/x', 'DELETE', {
        params: { id: (died.body as Json).event.id }
      });
      const stays = listLocationsForSubject('animal', ewe.animal.id);
      expect(stays.map((s) => [s.fieldId, s.toMs])).toEqual([
        [barn.id, tuesday],
        [field.id, null]
      ]);
      expectCacheMatchesTimeline('animal', ewe.animal.id);
    });
  });

  it('never leaves an open stay on an animal that is gone, whatever the order', async () => {
    const HOUR = 3600_000;
    const op = fc.oneof(
      fc.record({ kind: fc.constant('move' as const), area: fc.nat(2), hoursAgo: fc.nat(40) }),
      fc.record({
        kind: fc.constant('outcome' as const),
        status: fc.constantFrom('died', 'sold', 'rehomed'),
        hoursAgo: fc.nat(40)
      }),
      fc.record({ kind: fc.constant('restore' as const) }),
      fc.record({ kind: fc.constant('undo' as const) })
    );
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 10 }), async (ops) => {
        await runWithTenantAsync(seedOwner(), async () => {
          const areas = [pasture('A'), pasture('B'), createField({ name: 'Barn', kind: 'barn' })];
          const now = Date.now();
          const ewe = (
            await create({
              speciesId: 'sheep',
              tag: '1',
              housingFieldId: areas[0].id
            })
          ).body as Json;
          const id = ewe.animal.id;
          for (const o of ops) {
            if (o.kind === 'move') {
              await move({
                subjectType: 'animal',
                subjectId: id,
                fieldId: areas[o.area].id,
                movedAt: now - o.hoursAgo * HOUR
              });
            } else if (o.kind === 'outcome') {
              await status({
                subjectType: 'animal',
                subjectId: id,
                status: o.status,
                occurredAt: now - o.hoursAgo * HOUR
              });
            } else if (o.kind === 'restore') {
              await status({ subjectType: 'animal', subjectId: id, status: 'active' });
            } else {
              const latest = listStatusEvents('animal', id).at(-1);
              if (latest) {
                await call(UNDO_STATUS, '/animals/status/x', 'DELETE', {
                  params: { id: latest.id }
                });
              }
            }
            const stays = listLocationsForSubject('animal', id);
            expect(isNonOverlapping(stays)).toBe(true);
            const animal = getAnimal(id)!;
            if (animal.status !== 'active') expect(openStay(stays)).toBeUndefined();
            expectCacheMatchesTimeline('animal', id);
          }
        });
      }),
      { numRuns: 40 }
    );
  });
});

describe('group changes stay on record (B-04, B-07, B-08)', () => {
  it('a split keeps the stricter food flag of the group it came from', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const coop = createField({ name: 'Coop', kind: 'coop_pen' });
      const pen = createField({ name: 'Pen', kind: 'coop_pen' });
      const g = (
        await createGroup({
          name: 'Layers',
          speciesId: 'chicken',
          headCount: 10,
          housingFieldId: coop.id
        })
      ).body as Json;
      await patchGroup(g.group.id, { foodProducing: false, flagReason: 'Pet hens now' });
      const res = await move({
        subjectType: 'group',
        subjectId: g.group.id,
        fieldId: pen.id,
        count: 3
      });
      expect(res.status).toBe(201);
      expect((res.body as Json).move.newGroup.foodProducing).toBe(true);
    });
  });

  it('records a regroup at the old Area, and refuses one with no Area on either side', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const coop = createField({ name: 'Coop', kind: 'coop_pen' });
      const housed = (
        await createGroup({
          name: 'Layers',
          speciesId: 'chicken',
          headCount: 3,
          housingFieldId: coop.id,
          members: [{ name: 'Pearl' }]
        })
      ).body as Json;
      const unhoused = (await createGroup({ name: 'Bantams', speciesId: 'chicken', headCount: 2 }))
        .body as Json;
      const pearl = housed.members[0].id;
      const res = await move({
        subjectType: 'animal',
        subjectId: pearl,
        toGroupId: unhoused.group.id
      });
      expect(res.status).toBe(201);
      const marker = listLocationsForSubject('animal', pearl).at(-1)!;
      expect(marker).toMatchObject({
        fieldId: coop.id,
        fromGroupId: housed.group.id,
        toGroupId: unhoused.group.id
      });
      expect(getAnimal(pearl)).toMatchObject({ groupId: unhoused.group.id, housingFieldId: null });

      const loner = (await create({ speciesId: 'chicken', name: 'Solo' })).body as Json;
      const refused = await move({
        subjectType: 'animal',
        subjectId: loner.animal.id,
        toGroupId: unhoused.group.id
      });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: 'NO_AREA' });
      expect(getAnimal(loner.animal.id)?.groupId).toBeNull();
    });
  });
});
