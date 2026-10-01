// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({
  role: 'owner' as string,
  impersonating: false,
  knownDays: 10,
  onRegistry: undefined as undefined | (() => void),
  rebuilds: 0
}));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: 'hold-guard-user', role: m.role, impersonating: m.impersonating });
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
  const known = {
    pluginId: 'guard-known',
    type: 'herbicide',
    displayName: 'Known label',
    activeIngredients: [],
    get grazingRestrictions() {
      return {
        source: 'test label',
        grazeDays: m.knownDays,
        hayDays: m.knownDays,
        lactatingDairyGrazeDays: m.knownDays,
        meatAnimalRemovalBeforeSlaughterDays: 3
      };
    }
  };
  type Registry = Awaited<ReturnType<typeof actual.getRegistry>>;
  const wrap = (reg: Registry): Registry =>
    new Proxy(reg, {
      get(target, prop) {
        if (prop === 'get') {
          return (id: string) => (id === known.pluginId ? { plugin: known } : target.get(id));
        }
        if (prop === 'has') return (id: string) => id === known.pluginId || target.has(id);
        if (prop === 'all') return () => [...target.all(), { plugin: known }];
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      }
    }) as Registry;
  const species: Record<string, object> = {
    chicken: {
      pluginId: 'chicken',
      displayName: 'Chicken',
      foodProducingDefault: true,
      products: ['eggs', 'meat']
    }
  };
  return {
    ...actual,
    getRegistry: async () => {
      m.onRegistry?.();
      return wrap(await actual.getRegistry());
    },
    getBaseRegistry: async () => wrap(await actual.getBaseRegistry()),
    ownerRegistryNow: (base: Registry) => {
      m.rebuilds += 1;
      return base;
    },
    getDataKinds: async () => ({
      species: { get: (id: string) => species[id] },
      animalHealth: { get: () => undefined, has: () => false }
    })
  };
});

import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { animals, fungicideEvents, hayCuttings, recordDeletions } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, withTenant } from '$lib/db/tenant';
import { getFungicideEvent, insertFungicideEvent } from '$lib/db/fungicideEvents';
import {
  getProductionLog,
  insertProductionLog,
  listDeletedProductionLogs,
  listVoidedProductionLogs
} from '$lib/db/animalProduction';
import {
  getStatusEvent,
  insertStatusEvent,
  listUndoneStatusEvents,
  listVoidedStatusEvents
} from '$lib/db/animalStatus';
import { insertStay } from '$lib/db/animalLocations';
import { createCutting, getCutting } from '$lib/db/hayCuttings';
import { listHoldCorrections } from '$lib/db/holdCorrections';
import { recordedAtOf } from '$lib/db/holdParams';
import { guardedHoldWrite, projectActiveFarm } from './holdGuard';
import {
  DAY,
  HOUR,
  TEST_USER,
  UNKNOWN_HERBICIDE_ID,
  guardEvent,
  guardUser,
  seedFarm,
  seedOwner,
  spray,
  type Farm
} from './holdGuard.fixtures';
import { POST as VOID_FUNGICIDE } from '../../routes/api/fungicide/[id]/void/+server';
import { POST as VOID_PRODUCTION } from '../../routes/api/animals/production/[id]/void/+server';
import { POST as VOID_STATUS } from '../../routes/api/animals/status/[id]/void/+server';
import { POST as VOID_HAY } from '../../routes/api/hay/cuttings/[id]/void/+server';

const TZ = 'America/New_York';

let ownerId = '';
let farm: Farm;

beforeEach(() => {
  m.role = 'owner';
  m.impersonating = false;
  m.knownDays = 10;
  m.onRegistry = undefined;
  ownerId = seedOwner('void32g');
  farm = runWithTenant(ownerId, () => seedFarm(Date.now() - 200 * DAY));
});

const inFarm = <T>(fn: () => Promise<T>) => runWithTenantAsync(ownerId, fn);

type Handler = typeof VOID_FUNGICIDE;

async function call(
  handler: Handler,
  id: string,
  body: unknown,
  locals: Record<string, unknown> = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = new URL(`http://localhost/api/x/${id}/void`);
  try {
    const res = await handler({
      params: { id },
      url,
      request: new Request(url.href, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }),
      locals
    } as never);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : {} };
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (!status) throw e;
    return { status, body: {} };
  }
}

/** Voids through the route: the diff first, then the confirmed void. */
async function confirmVoid(handler: Handler, id: string, reason = 'Entered by mistake') {
  const first = await call(handler, id, { reason });
  expect(first.status).toBe(409);
  expect(first.body.code).toBe('HOLD_WOULD_SHORTEN');
  expect(first.body.canVoid).toBe(true);
  const stale = await call(handler, id, { reason, confirmShorten: '0'.repeat(64) });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('HOLD_DIFF_STALE');
  expect(listHoldCorrections(id)).toEqual([]);
  return call(handler, id, { reason, confirmShorten: first.body.diffHash });
}

function tombstonesOf(id: string) {
  return db
    .select()
    .from(recordDeletions)
    .where(withTenant(recordDeletions, eq(recordDeletions.recordId, id)))
    .all();
}

const fungicide = (atMs: number, pluginId = 'guard-known') =>
  insertFungicideEvent({
    blockId: farm.blockId,
    performedById: TEST_USER,
    occurredAt: atMs,
    products: [{ pluginId, displayName: 'Fungicide', fracCodes: ['M01'] }],
    conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
    rulesVersion: 'test',
    pluginHashes: {}
  });

const ownerWrite = <T>(fn: () => T) =>
  guardedHoldWrite(guardEvent('owner'), guardUser('owner'), fn);

/** The flock grazed the sprayed North pasture from two days ago. */
function flockOnSprayedPasture(pluginId?: string) {
  spray(farm, Date.now() - 3 * DAY, pluginId);
  insertStay({
    subject: { subjectType: 'group', subjectId: farm.groupId },
    fieldId: farm.pastureId,
    atMs: Date.now() - 2 * DAY,
    movedBy: null
  });
}

const eggsFor = (at: number, use: 'food' | 'discard' = 'food') =>
  insertProductionLog({
    subjectType: 'group',
    subjectId: farm.groupId,
    kind: 'eggs',
    quantity: 6,
    unit: 'eggs',
    occurredAt: at,
    use,
    rulesVersion: 'test',
    performedById: TEST_USER
  });

describe('32G G4 void routes: shared refusals', () => {
  const kinds: Array<[string, Handler]> = [
    ['fungicide', VOID_FUNGICIDE],
    ['production', VOID_PRODUCTION],
    ['status', VOID_STATUS],
    ['hay', VOID_HAY]
  ];

  it.each(kinds)('%s: refuses a helper, an API token and an impersonating owner', async (_k, h) => {
    await inFarm(async () => {
      m.role = 'helper';
      expect(await call(h, 'x', { reason: 'x' })).toMatchObject({
        status: 403,
        body: { code: 'OWNER_ONLY' }
      });
      m.role = 'owner';
      expect(await call(h, 'x', { reason: 'x' }, { authVia: 'bearer' })).toMatchObject({
        status: 403,
        body: { code: 'OWNER_ONLY' }
      });
      m.impersonating = true;
      expect(await call(h, 'x', { reason: 'x' })).toMatchObject({
        status: 403,
        body: { code: 'OWNER_ONLY' }
      });
      m.impersonating = false;
      m.role = 'inspector';
      expect((await call(h, 'x', { reason: 'x' })).status).toBe(403);
    });
  });

  it.each(kinds)('%s: needs a reason and answers 404 for a missing record', async (_k, h) => {
    await inFarm(async () => {
      expect((await call(h, 'nope', {})).status).toBe(400);
      expect((await call(h, 'nope', { reason: '   ' })).status).toBe(400);
      expect(await call(h, 'nope', { reason: 'x' })).toMatchObject({ status: 404 });
    });
  });
});

describe('32G G4 fungicide void', () => {
  it('voids a fresh application after the confirmed diff, with a tombstone and one correction', async () => {
    await inFarm(async () => {
      const f = await ownerWrite(() => fungicide(Date.now() - DAY));
      expect(recordedAtOf('fungicide', f.id)).not.toBeNull();
      const before = await projectActiveFarm(TZ);
      expect(before.projection.holds.get(`area:${farm.pastureId}|graze`)?.length).toBe(1);
      const done = await confirmVoid(VOID_FUNGICIDE, f.id, 'Wrong paddock');
      expect(done).toMatchObject({ status: 200, body: { voided: f.id, kind: 'fungicide' } });
      expect(getFungicideEvent(f.id)).toBeUndefined();
      const rows = listHoldCorrections(f.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ recordKind: 'fungicide', reason: 'Wrong paddock' });
      const tomb = tombstonesOf(f.id);
      expect(tomb).toHaveLength(1);
      expect(tomb[0].recordKind).toBe('fungicide');
      expect(JSON.parse(tomb[0].snapshotJson).neverApplied).toBe(true);
      const after = await projectActiveFarm(TZ);
      expect(after.projection.holds.get(`area:${farm.pastureId}|graze`)).toBeUndefined();
    });
  });

  it('is too late for an application saved before C-35 or more than 48 hours ago', async () => {
    await inFarm(async () => {
      const old = fungicide(Date.now() - DAY);
      expect(recordedAtOf('fungicide', old.id)).toBeNull();
      expect(await call(VOID_FUNGICIDE, old.id, { reason: 'x' })).toMatchObject({
        status: 409,
        body: { code: 'VOID_TOO_LATE' }
      });
      const f = await ownerWrite(() => fungicide(Date.now() - DAY));
      const row = db
        .select({ json: fungicideEvents.holdParamsJson })
        .from(fungicideEvents)
        .where(withTenant(fungicideEvents, eq(fungicideEvents.id, f.id)))
        .get();
      const params = JSON.parse(row!.json!);
      params.recordedAtMs = Date.now() - 48 * HOUR - 1000;
      db.update(fungicideEvents)
        .set({ holdParamsJson: JSON.stringify(params) })
        .where(withTenant(fungicideEvents, eq(fungicideEvents.id, f.id)))
        .run();
      expect(await call(VOID_FUNGICIDE, f.id, { reason: 'x' })).toMatchObject({
        status: 409,
        body: { code: 'VOID_TOO_LATE' }
      });
      expect(getFungicideEvent(f.id)).toBeDefined();
    });
  });

  it('never shortens a hold from an unknown label', async () => {
    await inFarm(async () => {
      const f = await ownerWrite(() => fungicide(Date.now() - DAY, UNKNOWN_HERBICIDE_ID));
      const first = await call(VOID_FUNGICIDE, f.id, { reason: 'x' });
      expect(first).toMatchObject({
        status: 403,
        body: { code: 'HOLD_NOT_VOIDABLE', canVoid: false }
      });
      const e = await call(VOID_FUNGICIDE, f.id, {
        reason: 'x',
        confirmShorten: first.body.diffHash
      });
      expect(e).toMatchObject({ status: 403, body: { code: 'HOLD_NOT_VOIDABLE' } });
      expect(getFungicideEvent(f.id)).toBeDefined();
      expect(listHoldCorrections(f.id)).toEqual([]);
    });
  });

  it('voids a fresh entry whose holds shorten nothing at once, with no correction row', async () => {
    await inFarm(async () => {
      m.knownDays = 0;
      const f = await ownerWrite(() =>
        insertFungicideEvent({
          blockId: farm.otherBlockId,
          performedById: TEST_USER,
          occurredAt: Date.now() - 10 * DAY,
          products: [{ pluginId: 'guard-known', displayName: 'F', fracCodes: ['M01'] }],
          conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
          rulesVersion: 'test',
          pluginHashes: {}
        })
      );
      const res = await call(VOID_FUNGICIDE, f.id, { reason: 'Typo' });
      expect(res.status).toBe(200);
      expect(listHoldCorrections(f.id)).toEqual([]);
    });
  });
});

describe('32G G4 production void', () => {
  it('voids a covered food log, which then stops counting as covered', async () => {
    await inFarm(async () => {
      flockOnSprayedPasture();
      const log = eggsFor(Date.now() - DAY);
      const before = await projectActiveFarm(TZ);
      expect(before.projection.covered.has(`log:${log.id}`)).toBe(true);
      const done = await confirmVoid(VOID_PRODUCTION, log.id);
      expect(done).toMatchObject({
        status: 200,
        body: { voided: log.id, kind: 'animal-production' }
      });
      expect(getProductionLog(log.id)).toBeUndefined();
      expect(listHoldCorrections(log.id)).toHaveLength(1);
      expect(listHoldCorrections(log.id)[0].recordKind).toBe('animal-production');
      const tomb = tombstonesOf(log.id);
      expect(tomb).toHaveLength(1);
      expect(JSON.parse(tomb[0].snapshotJson)).toMatchObject({ action: 'delete', voided: true });
      expect(listDeletedProductionLogs().map((l) => l.id)).not.toContain(log.id);
      expect(listVoidedProductionLogs().map((l) => l.id)).toContain(log.id);
      const after = await projectActiveFarm(TZ);
      expect(after.projection.covered.has(`log:${log.id}`)).toBe(false);
    });
  });

  it('voids a log that shortens nothing at once, with no correction row', async () => {
    await inFarm(async () => {
      const log = eggsFor(Date.now() - DAY, 'discard');
      expect(await call(VOID_PRODUCTION, log.id, { reason: 'Double entry' })).toMatchObject({
        status: 200
      });
      expect(getProductionLog(log.id)).toBeUndefined();
      expect(listHoldCorrections(log.id)).toEqual([]);
      expect(tombstonesOf(log.id)).toHaveLength(1);
    });
  });

  it('is too late 48 hours after the log was saved, even for a recent date', async () => {
    await inFarm(async () => {
      const log = insertProductionLog({
        subjectType: 'group',
        subjectId: farm.groupId,
        kind: 'eggs',
        quantity: 6,
        unit: 'eggs',
        occurredAt: Date.now() - 3 * DAY,
        use: 'discard',
        rulesVersion: 'test',
        performedById: TEST_USER,
        createdAt: Date.now() - 48 * HOUR - 1000
      });
      expect(await call(VOID_PRODUCTION, log.id, { reason: 'x' })).toMatchObject({
        status: 409,
        body: { code: 'VOID_TOO_LATE' }
      });
      expect(getProductionLog(log.id)).toBeDefined();
    });
  });

  it('refuses to drop a log covered by a hold from an unknown label', async () => {
    await inFarm(async () => {
      flockOnSprayedPasture(UNKNOWN_HERBICIDE_ID);
      const log = eggsFor(Date.now() - DAY);
      const first = await call(VOID_PRODUCTION, log.id, { reason: 'x' });
      expect(first).toMatchObject({
        status: 403,
        body: { code: 'HOLD_NOT_VOIDABLE', canVoid: false }
      });
      const e = await call(VOID_PRODUCTION, log.id, {
        reason: 'x',
        confirmShorten: first.body.diffHash
      });
      expect(e).toMatchObject({ status: 403, body: { code: 'HOLD_NOT_VOIDABLE' } });
      expect(getProductionLog(log.id)).toBeDefined();
    });
  });
});

describe('32G G4 status void', () => {
  const died = (at: number, createdAt?: number) =>
    insertStatusEvent({
      subjectType: 'animal',
      subjectId: farm.henId,
      status: 'died',
      occurredAt: at,
      recordedById: TEST_USER,
      ...(createdAt !== undefined ? { createdAt } : {})
    });

  it('runs the undo path, restores the animal and marks its tombstone voided', async () => {
    await inFarm(async () => {
      db.update(animals)
        .set({ status: 'died' })
        .where(withTenant(animals, eq(animals.id, farm.henId)))
        .run();
      const ev = died(Date.now() - 3 * DAY);
      const res = await call(VOID_STATUS, ev.id, { reason: 'She is fine' });
      expect(res).toMatchObject({ status: 200, body: { voided: ev.id, kind: 'animal-status' } });
      expect(getStatusEvent(ev.id)).toBeUndefined();
      const hen = db
        .select()
        .from(animals)
        .where(withTenant(animals, eq(animals.id, farm.henId)))
        .get();
      expect(hen?.status).toBe('active');
      const tomb = tombstonesOf(ev.id);
      expect(tomb).toHaveLength(1);
      expect(tomb[0].reason).toBe('She is fine');
      expect(JSON.parse(tomb[0].snapshotJson)).toMatchObject({ action: 'undo', voided: true });
      expect(listUndoneStatusEvents().map((e) => e.id)).not.toContain(ev.id);
      expect(listVoidedStatusEvents().map((e) => e.id)).toContain(ev.id);
      expect(listHoldCorrections(ev.id)).toEqual([]);
    });
  });

  it('only voids the latest change', async () => {
    await inFarm(async () => {
      const first = insertStatusEvent({
        subjectType: 'animal',
        subjectId: farm.henId,
        status: 'culled',
        occurredAt: Date.now() - 2 * DAY,
        recordedById: TEST_USER
      });
      died(Date.now() - DAY);
      expect(await call(VOID_STATUS, first.id, { reason: 'x' })).toMatchObject({
        status: 409,
        body: { code: 'NOT_LATEST' }
      });
      expect(getStatusEvent(first.id)).toBeDefined();
    });
  });

  it('is too late 48 hours after the change was saved', async () => {
    await inFarm(async () => {
      const ev = died(Date.now() - 3 * DAY, Date.now() - 48 * HOUR - 1000);
      expect(await call(VOID_STATUS, ev.id, { reason: 'x' })).toMatchObject({
        status: 409,
        body: { code: 'VOID_TOO_LATE' }
      });
    });
  });

  it('a voided slaughter inside a hold needs the confirmed diff and leaves a correction', async () => {
    await inFarm(async () => {
      flockOnSprayedPasture();
      const ev = insertStatusEvent({
        subjectType: 'animal',
        subjectId: farm.henId,
        status: 'slaughtered',
        occurredAt: Date.now() - DAY,
        recordedById: TEST_USER
      });
      const before = await projectActiveFarm(TZ);
      expect(before.projection.covered.has(`meat:${ev.id}`)).toBe(true);
      const done = await confirmVoid(VOID_STATUS, ev.id);
      expect(done.status).toBe(200);
      expect(listHoldCorrections(ev.id)).toHaveLength(1);
      expect(listHoldCorrections(ev.id)[0].recordKind).toBe('animal-status');
      const after = await projectActiveFarm(TZ);
      expect(after.projection.covered.has(`meat:${ev.id}`)).toBe(false);
    });
  });
});

describe('32G G4 hay void', () => {
  const cut = (mowAt: number) =>
    createCutting({
      blockId: farm.blockId,
      cropPluginId: 'test-hay',
      year: new Date(mowAt).getFullYear(),
      mowAt,
      performedById: TEST_USER,
      rulesVersion: 'test'
    });

  it('voids a covered cutting with a voided hay tombstone and a correction', async () => {
    await inFarm(async () => {
      spray(farm, Date.now() - 3 * DAY);
      const c = cut(Date.now() - DAY);
      const before = await projectActiveFarm(TZ);
      expect(before.projection.covered.has(`hay:${c.id}`)).toBe(true);
      const done = await confirmVoid(VOID_HAY, c.id);
      expect(done).toMatchObject({ status: 200, body: { voided: c.id, kind: 'hay' } });
      expect(getCutting(c.id)).toBeUndefined();
      expect(listHoldCorrections(c.id)[0]).toMatchObject({ recordKind: 'hay' });
      const tomb = tombstonesOf(c.id);
      expect(tomb).toHaveLength(1);
      expect(tomb[0].recordKind).toBe('hay');
      expect(JSON.parse(tomb[0].snapshotJson)).toMatchObject({ voided: true });
    });
  });

  it('voids an uncovered cutting at once and refuses one saved over 48 hours ago', async () => {
    await inFarm(async () => {
      const c = cut(Date.now() - DAY);
      expect(await call(VOID_HAY, c.id, { reason: 'Wrong field' })).toMatchObject({
        status: 200
      });
      expect(listHoldCorrections(c.id)).toEqual([]);
      const old = cut(Date.now() - 2 * DAY);
      db.update(hayCuttings)
        .set({ createdAt: new Date(Date.now() - 48 * HOUR - 1000) })
        .where(withTenant(hayCuttings, eq(hayCuttings.id, old.id)))
        .run();
      expect(await call(VOID_HAY, old.id, { reason: 'x' })).toMatchObject({
        status: 409,
        body: { code: 'VOID_TOO_LATE' }
      });
      expect(getCutting(old.id)).toBeDefined();
    });
  });

  it('never drops a cutting covered by a hold from an unknown label', async () => {
    await inFarm(async () => {
      spray(farm, Date.now() - 3 * DAY, UNKNOWN_HERBICIDE_ID);
      const c = cut(Date.now() - DAY);
      const first = await call(VOID_HAY, c.id, { reason: 'x' });
      expect(first).toMatchObject({
        status: 403,
        body: { code: 'HOLD_NOT_VOIDABLE', canVoid: false }
      });
      expect(
        await call(VOID_HAY, c.id, { reason: 'x', confirmShorten: first.body.diffHash })
      ).toMatchObject({ status: 403, body: { code: 'HOLD_NOT_VOIDABLE' } });
      expect(getCutting(c.id)).toBeDefined();
    });
  });
});

describe('32G G4 tenant isolation', () => {
  it('another farm cannot void these records (404)', async () => {
    const ids = await inFarm(async () => ({
      f: (await ownerWrite(() => fungicide(Date.now() - DAY))).id,
      log: eggsFor(Date.now() - DAY, 'discard').id,
      c: createCutting({
        blockId: farm.blockId,
        cropPluginId: 'test-hay',
        year: 2026,
        mowAt: Date.now() - DAY,
        rulesVersion: 'test'
      }).id
    }));
    const other = seedOwner('void32g-other');
    runWithTenant(other, () => seedFarm(Date.now() - 10 * DAY));
    await runWithTenantAsync(other, async () => {
      expect((await call(VOID_FUNGICIDE, ids.f, { reason: 'x' })).status).toBe(404);
      expect((await call(VOID_PRODUCTION, ids.log, { reason: 'x' })).status).toBe(404);
      expect((await call(VOID_HAY, ids.c, { reason: 'x' })).status).toBe(404);
    });
    await inFarm(async () => {
      expect(getFungicideEvent(ids.f)).toBeDefined();
      expect(getProductionLog(ids.log)).toBeDefined();
      expect(getCutting(ids.c)).toBeDefined();
    });
  });
});
