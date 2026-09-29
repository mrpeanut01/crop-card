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

import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db/client';
import {
  animalHealthEvents,
  helperAssignments,
  owners,
  recordDeletions,
  sprayEvents,
  users
} from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, withTenant } from '$lib/db/tenant';
import { deleteSprayEvent } from '$lib/db/admin';
import { getSprayEvent } from '$lib/db/sprayEvents';
import { getInsecticideEvent, insertInsecticideEvent } from '$lib/db/insecticideEvents';
import { insertProductionLog, setProductionUse } from '$lib/db/animalProduction';
import { insertStatusEvent } from '$lib/db/animalStatus';
import { insertHealthEvent } from '$lib/db/animalHealth';
import { insertStay, listLocationsForSubject } from '$lib/db/animalLocations';
import { listHoldCorrections } from '$lib/db/holdCorrections';
import { readHoldParams, recordedAtOf } from '$lib/db/holdParams';
import { updateBlock } from '$lib/db/blocks';
import { createCutting } from '$lib/db/hayCuttings';
import { farmTimeZone } from '$lib/db/userProfile';
import { roundedClearMs } from '$lib/safety/grazingInterval';
import { insertGrazingAttestation } from '$lib/db/grazingAttestations';
import { AnimalRuleError } from './animals';
import {
  DECLARATION_LOOKBACK_HELPER_MS,
  DECLARATION_LOOKBACK_OWNER_MS,
  OTHER_LOOKBACK_MS,
  guardedHoldWrite,
  projectActiveFarm,
  backfillHoldParamsEverywhere,
  zoneChangeShortensHolds,
  changeOwnerZone,
  type GuardOptions
} from './holdGuard';
import { MAX_FUTURE_SKEW_MS } from '$lib/animals/model';
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
  type Farm,
  type Tier
} from './holdGuard.fixtures';
import { POST as VOID_SPRAY } from '../../routes/api/spray/records/[id]/void/+server';
import { POST as VOID_LOCATION } from '../../routes/api/animals/locations/[id]/void/+server';
import { POST as VOID_HEALTH } from '../../routes/api/animals/health/[id]/void/+server';
import { POST as VOID_INSECTICIDE } from '../../routes/api/insecticide/[id]/void/+server';
import { DELETE as DELETE_SPRAY } from '../../routes/api/spray/records/[id]/+server';
import { DELETE as DELETE_INSECTICIDE } from '../../routes/api/insecticide/[id]/+server';
import { POST as UPLOAD_PLUGIN } from '../../routes/api/plugins/upload/+server';

const TZ = 'America/New_York';

let ownerId = '';
let farm: Farm;

beforeEach(() => {
  m.role = 'owner';
  m.impersonating = false;
  m.knownDays = 10;
  m.onRegistry = undefined;
  ownerId = seedOwner();
  farm = runWithTenant(ownerId, () => seedFarm(Date.now() - 200 * DAY));
});

const inFarm = <T>(fn: () => Promise<T>) => runWithTenantAsync(ownerId, fn);

async function refusal(p: Promise<unknown>): Promise<AnimalRuleError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AnimalRuleError) return e;
    throw e;
  }
  throw new Error('expected the guard to refuse the write');
}

const write = <T>(tier: Tier, fn: () => T, opts: GuardOptions = {}) =>
  guardedHoldWrite(guardEvent(tier), guardUser(tier), fn, opts);

/** A spray on the North pasture, through the guard, `daysAgo` days back. */
async function guardedSpray(daysAgo: number, pluginId?: string) {
  return write('owner', () => spray(farm, Date.now() - daysAgo * DAY, pluginId));
}

async function call(
  handler: unknown,
  path: string,
  body: unknown,
  opts: { params?: Record<string, string>; locals?: Record<string, unknown> } = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = new URL(`http://localhost/api${path}`);
  try {
    const res = await (handler as (e: never) => Promise<Response>)({
      params: opts.params ?? {},
      url,
      request: new Request(url.href, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
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

describe('C-35 guard: holds never shorten', () => {
  it('accepts a record that only adds a hold and stores its hold parameters', async () => {
    await inFarm(async () => {
      const before = Date.now();
      const s = await guardedSpray(2);
      const recordedAt = recordedAtOf('spray', s.id);
      expect(recordedAt).not.toBeNull();
      expect(recordedAt!).toBeGreaterThanOrEqual(before);
      const { projection } = await projectActiveFarm(TZ);
      expect(projection.holds.get(`area:${farm.pastureId}|graze`)?.length).toBe(1);
    });
  });

  it('refuses a never-applied delete and rolls the whole write back', async () => {
    await inFarm(async () => {
      const s = await guardedSpray(2);
      const e = await refusal(
        write('owner', () =>
          deleteSprayEvent(s.id, { force: true, tombstone: true, neverApplied: true })
        )
      );
      expect(e.code).toBe('HOLD_WOULD_SHORTEN');
      expect(e.status).toBe(409);
      expect(getSprayEvent(s.id)).toBeDefined();
      const tombstones = db
        .select()
        .from(recordDeletions)
        .where(withTenant(recordDeletions, eq(recordDeletions.recordId, s.id)))
        .all();
      expect(tombstones).toEqual([]);
      const holds = e.extra.holds as { kind: string; subject: string }[];
      expect(holds.map((h) => h.kind).sort()).toEqual(['graze', 'hay']);
      expect(holds[0].subject).toBe(`area:${farm.pastureId}`);
      expect(typeof e.extra.diffHash).toBe('string');
    });
  });

  it('keeps the hold of a plain delete, which leaves a tombstone', async () => {
    await inFarm(async () => {
      const s = await guardedSpray(2);
      await write('owner', () => deleteSprayEvent(s.id, { force: true, tombstone: true }));
      expect(getSprayEvent(s.id)).toBeUndefined();
      const { projection } = await projectActiveFarm(TZ);
      expect(projection.holds.get(`area:${farm.pastureId}|graze`)?.length).toBe(1);
    });
  });

  it('refuses moving a sprayed block to another Area', async () => {
    await inFarm(async () => {
      await guardedSpray(2);
      const e = await refusal(
        write('owner', () => updateBlock(farm.blockId, { fieldId: farm.otherPastureId }))
      );
      expect(e.code).toBe('HOLD_WOULD_SHORTEN');
    });
  });

  it('refuses a backdated move off a sprayed pasture that ends a pre-slaughter hold early', async () => {
    await inFarm(async () => {
      await guardedSpray(20);
      const subject = { subjectType: 'group' as const, subjectId: farm.groupId };
      await write('owner', () =>
        insertStay({ subject, fieldId: farm.pastureId, atMs: Date.now() - 5 * DAY, movedBy: null })
      );
      const e = await refusal(
        write('owner', () =>
          insertStay({ subject, fieldId: farm.barnId, atMs: Date.now() - 4 * DAY, movedBy: null })
        )
      );
      expect(e.code).toBe('HOLD_WOULD_SHORTEN');
      const holds = e.extra.holds as { kind: string; subject: string }[];
      expect(holds).toContainEqual(
        expect.objectContaining({ kind: 'preSlaughter', subject: `group:${farm.groupId}` })
      );
      expect(listLocationsForSubject('group', farm.groupId).at(-1)?.fieldId).toBe(farm.pastureId);
      await write('owner', () =>
        insertStay({ subject, fieldId: farm.barnId, atMs: Date.now(), movedBy: null })
      );
      expect(listLocationsForSubject('group', farm.groupId).at(-1)?.fieldId).toBe(farm.barnId);
    });
  });

  it('tells each tier its way out', async () => {
    await inFarm(async () => {
      const s = await guardedSpray(2);
      const del = () =>
        deleteSprayEvent(s.id, { force: true, tombstone: true, neverApplied: true });
      const owner = await refusal(write('owner', del, { dated: true }));
      expect(owner.extra).toMatchObject({
        canVoid: false,
        askOwner: false,
        todayVersionPasses: true
      });
      for (const tier of ['helper', 'bearer', 'impersonating'] as const) {
        const e = await refusal(write(tier, del));
        expect(e.code).toBe('HOLD_WOULD_SHORTEN');
        expect(e.extra).toMatchObject({ canVoid: false, askOwner: true });
      }
    });
  });

  it('lets only an interactive owner fill in an unknown hold', async () => {
    await inFarm(async () => {
      const s = await guardedSpray(2, 'guard-unsourced');
      const del = () =>
        deleteSprayEvent(s.id, { force: true, tombstone: true, neverApplied: true });
      for (const tier of ['helper', 'bearer', 'impersonating'] as const) {
        const e = await refusal(write(tier, del, { resolvesUnknown: true }));
        expect(e.code).toBe('HOLD_WOULD_SHORTEN');
      }
      await write('owner', del, { resolvesUnknown: true });
      expect(getSprayEvent(s.id)).toBeUndefined();
    });
  });

  it('lets a grazing attestation fill an unknown interval only for the interactive owner', async () => {
    await inFarm(async () => {
      const s = await guardedSpray(2, 'guard-unsourced');
      const attest = () =>
        insertGrazingAttestation({
          fieldId: farm.pastureId,
          productPluginId: 'guard-unsourced',
          sprayEventRef: `spray:${s.id}`,
          grazeDays: 1,
          hayDays: 1,
          reason: 'Read from the label',
          attestedBy: TEST_USER
        });
      for (const tier of ['helper', 'bearer', 'impersonating'] as const) {
        const e = await refusal(write(tier, attest, { resolvesUnknown: true }));
        expect(e.code).toBe('HOLD_WOULD_SHORTEN');
      }
      await write('owner', attest, { resolvesUnknown: true });
    });
  });

  it('only projects the active Owner', async () => {
    await inFarm(async () => {
      await guardedSpray(2);
    });
    const other = seedOwner('guard-other');
    const otherFarm = runWithTenant(other, () => seedFarm(Date.now() - 10 * DAY));
    await runWithTenantAsync(other, async () => {
      await write('owner', () => spray(otherFarm, Date.now() - DAY));
      const { projection } = await projectActiveFarm(TZ);
      const keys = [...projection.holds.keys()];
      expect(keys.some((k) => k.includes(farm.pastureId))).toBe(false);
      expect(keys.some((k) => k.includes(otherFarm.pastureId))).toBe(true);
      expect(listHoldCorrections()).toEqual([]);
    });
  });

  it('never takes a promise as the write', async () => {
    await inFarm(async () => {
      await expect(write('owner', () => Promise.resolve(1))).rejects.toThrow(/synchronous/);
    });
  });
});

describe('C-35 §1 date checks', () => {
  it('refuses any record dated more than five minutes ahead', async () => {
    await inFarm(async () => {
      const nowMs = Date.now();
      const e = await refusal(
        write('owner', () => spray(farm, nowMs + MAX_FUTURE_SKEW_MS + 1), { nowMs })
      );
      expect(e.code).toBe('IN_THE_FUTURE');
      expect(e.status).toBe(400);
      await write('owner', () => spray(farm, nowMs + MAX_FUTURE_SKEW_MS), { nowMs });
    });
  });

  const eggs = (at: number) => () =>
    insertProductionLog({
      subjectType: 'group',
      subjectId: farm.groupId,
      kind: 'eggs',
      quantity: 6,
      unit: 'eggs',
      occurredAt: at,
      use: 'food',
      rulesVersion: 'test',
      performedById: TEST_USER
    });

  it('dates eggs, milk, meat and hay 7 days back for the owner and 24 hours for everyone else', async () => {
    await inFarm(async () => {
      const nowMs = Date.now();
      const tooOld = await refusal(
        write('owner', eggs(nowMs - DECLARATION_LOOKBACK_OWNER_MS - 1), { nowMs })
      );
      expect(tooOld.code).toBe('BACKDATE_TOO_FAR');
      expect(tooOld.status).toBe(422);
      expect(tooOld.extra).toMatchObject({ windowDays: 7, declaration: true });
      await write('owner', eggs(nowMs - DECLARATION_LOOKBACK_OWNER_MS), { nowMs });
      for (const tier of ['helper', 'bearer', 'impersonating'] as const) {
        const e = await refusal(
          write(tier, eggs(nowMs - DECLARATION_LOOKBACK_HELPER_MS - 1), { nowMs })
        );
        expect(e.code).toBe('BACKDATE_TOO_FAR');
        expect(e.extra).toMatchObject({ windowDays: 1 });
        await write(tier, eggs(nowMs - DECLARATION_LOOKBACK_HELPER_MS), { nowMs });
      }
    });
  });

  it('dates other records up to 400 days back for every role', async () => {
    await inFarm(async () => {
      const nowMs = Date.now();
      for (const tier of ['owner', 'helper'] as const) {
        const e = await refusal(
          write(tier, () => spray(farm, nowMs - OTHER_LOOKBACK_MS - 1), { nowMs })
        );
        expect(e.code).toBe('BACKDATE_TOO_FAR');
        expect(e.extra).toMatchObject({ windowDays: 400, declaration: false });
        await write(tier, () => spray(farm, nowMs - OTHER_LOOKBACK_MS), { nowMs });
      }
    });
  });
});

describe('C-35 §4 declarations and lifecycle order', () => {
  it('refuses food eggs dated inside a hold on file', async () => {
    await inFarm(async () => {
      await write('owner', () =>
        insertHealthEvent({
          subjectType: 'group',
          subjectId: farm.groupId,
          kind: 'deworm',
          productName: 'Unknown wormer',
          administeredAt: Date.now() - 2 * DAY,
          withdrawalClear: null,
          rulesVersion: 'test',
          foodProducingAtRecord: true,
          performedById: TEST_USER
        })
      );
      const e = await refusal(
        write('owner', () =>
          insertProductionLog({
            subjectType: 'group',
            subjectId: farm.groupId,
            kind: 'eggs',
            quantity: 6,
            unit: 'eggs',
            occurredAt: Date.now() - DAY,
            use: 'food',
            rulesVersion: 'test',
            performedById: TEST_USER
          })
        )
      );
      expect(e.code).toBe('HOLD_ACTIVE');
      expect(e.extra.resubmitAs).toBe('discard');
    });
  });

  it('refuses a declaration dated before a hold that is already on file (§4c)', async () => {
    await inFarm(async () => {
      await write('owner', () =>
        insertHealthEvent({
          subjectType: 'group',
          subjectId: farm.groupId,
          kind: 'deworm',
          productName: 'Unknown wormer',
          administeredAt: Date.now() - DAY,
          withdrawalClear: null,
          rulesVersion: 'test',
          foodProducingAtRecord: true,
          performedById: TEST_USER
        })
      );
      const e = await refusal(
        write('owner', () =>
          insertProductionLog({
            subjectType: 'group',
            subjectId: farm.groupId,
            kind: 'eggs',
            quantity: 6,
            unit: 'eggs',
            occurredAt: Date.now() - 2 * DAY,
            use: 'food',
            rulesVersion: 'test',
            performedById: TEST_USER
          })
        )
      );
      expect(e.code).toBe('OUT_OF_ORDER');
      expect(e.message).toMatch(/Unknown wormer is on record for Layers/);
    });
  });

  it('checks eggs logged as discarded and then changed to food like new food eggs', async () => {
    await inFarm(async () => {
      const log = await write('owner', () =>
        insertProductionLog({
          subjectType: 'group',
          subjectId: farm.groupId,
          kind: 'eggs',
          quantity: 6,
          unit: 'eggs',
          occurredAt: Date.now() - DAY,
          use: 'discard',
          rulesVersion: 'test',
          performedById: TEST_USER
        })
      );
      await write('owner', () =>
        insertHealthEvent({
          subjectType: 'group',
          subjectId: farm.groupId,
          kind: 'deworm',
          productName: 'Unknown wormer',
          administeredAt: Date.now() - 2 * DAY,
          withdrawalClear: null,
          rulesVersion: 'test',
          foodProducingAtRecord: true,
          performedById: TEST_USER
        })
      );
      const e = await refusal(
        write('owner', () =>
          setProductionUse(log, 'food', { by: TEST_USER, reason: null, rulesVersion: 'test' })
        )
      );
      expect(e.code).toBe('HOLD_ACTIVE');
    });
  });

  it('rechecks eggs changed from food to discard and back to food (review round 2)', async () => {
    await inFarm(async () => {
      const eggs = {
        subjectType: 'group' as const,
        subjectId: farm.groupId,
        kind: 'eggs' as const,
        quantity: 6,
        unit: 'eggs',
        occurredAt: Date.now() - DAY,
        use: 'food' as const,
        rulesVersion: 'test',
        performedById: TEST_USER
      };
      const log = await write('owner', () => insertProductionLog(eggs));
      const discarded = await write('owner', () =>
        setProductionUse(log, 'discard', { by: TEST_USER, reason: null, rulesVersion: 'test' })
      );
      await write('owner', () =>
        insertHealthEvent({
          subjectType: 'group',
          subjectId: farm.groupId,
          kind: 'deworm',
          productName: 'Unknown wormer',
          administeredAt: Date.now() - 2 * DAY,
          withdrawalClear: null,
          rulesVersion: 'test',
          foodProducingAtRecord: true,
          performedById: TEST_USER
        })
      );
      const e = await refusal(
        write('owner', () =>
          setProductionUse(discarded!, 'food', {
            by: TEST_USER,
            reason: null,
            rulesVersion: 'test'
          })
        )
      );
      expect(e.code).toBe('HOLD_ACTIVE');
      await write('owner', () =>
        setProductionUse(discarded!, 'unknown', {
          by: TEST_USER,
          reason: null,
          rulesVersion: 'test'
        })
      );
    });
  });

  it('keeps a death last: nothing is dated after it, and it is never dated before a record', async () => {
    await inFarm(async () => {
      const at = Date.now() - 2 * DAY;
      await write('owner', () =>
        insertStatusEvent({
          subjectType: 'animal',
          subjectId: farm.henId,
          status: 'died',
          occurredAt: at,
          recordedById: TEST_USER
        })
      );
      const after = await refusal(
        write('owner', () =>
          insertProductionLog({
            subjectType: 'animal',
            subjectId: farm.henId,
            kind: 'eggs',
            quantity: 1,
            unit: 'eggs',
            occurredAt: at + HOUR,
            use: 'discard',
            rulesVersion: 'test',
            performedById: TEST_USER
          })
        )
      );
      expect(after.code).toBe('OUT_OF_ORDER');
      expect(after.message).toMatch(/recorded as died/);
    });
    const other = seedOwner('guard-order');
    const otherFarm = runWithTenant(other, () => seedFarm(Date.now() - 10 * DAY));
    await runWithTenantAsync(other, async () => {
      await write('owner', () =>
        insertProductionLog({
          subjectType: 'animal',
          subjectId: otherFarm.henId,
          kind: 'eggs',
          quantity: 1,
          unit: 'eggs',
          occurredAt: Date.now() - DAY,
          use: 'discard',
          rulesVersion: 'test',
          performedById: TEST_USER
        })
      );
      const before = await refusal(
        write('owner', () =>
          insertStatusEvent({
            subjectType: 'animal',
            subjectId: otherFarm.henId,
            status: 'died',
            occurredAt: Date.now() - 2 * DAY,
            recordedById: TEST_USER
          })
        )
      );
      expect(before.code).toBe('OUT_OF_ORDER');
    });
  });
});

describe('C-35 §5 the owner void', () => {
  const voidOf = (id: string, createdAtMs: number, confirmShorten?: string | null) => ({
    void: {
      recordKind: 'spray',
      recordId: id,
      createdAtMs,
      reason: 'Wrong paddock',
      confirmShorten
    }
  });
  const neverApplied = (id: string) => () =>
    deleteSprayEvent(id, { force: true, tombstone: true, neverApplied: true, reason: 'x' });

  it('answers the diff first, then saves only with the matching hash and one audit row', async () => {
    await inFarm(async () => {
      const s = await guardedSpray(1);
      const created = recordedAtOf('spray', s.id)!;
      const first = await refusal(write('owner', neverApplied(s.id), voidOf(s.id, created)));
      expect(first.code).toBe('HOLD_WOULD_SHORTEN');
      expect(first.extra.canVoid).toBe(true);
      const hash = first.extra.diffHash as string;
      const stale = await refusal(
        write('owner', neverApplied(s.id), voidOf(s.id, created, 'f'.repeat(64)))
      );
      expect(stale.code).toBe('HOLD_DIFF_STALE');
      expect(listHoldCorrections(s.id)).toEqual([]);
      await write('owner', neverApplied(s.id), voidOf(s.id, created, hash));
      expect(getSprayEvent(s.id)).toBeUndefined();
      const rows = listHoldCorrections(s.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        recordKind: 'spray',
        diffHash: hash,
        userId: TEST_USER,
        reason: 'Wrong paddock'
      });
      const { projection } = await projectActiveFarm(TZ);
      expect(projection.holds.get(`area:${farm.pastureId}|graze`)).toBeUndefined();
    });
  });

  it('is never open to a helper, an API token or an impersonating superadmin', async () => {
    await inFarm(async () => {
      const s = await guardedSpray(1);
      const created = recordedAtOf('spray', s.id)!;
      const first = await refusal(write('owner', neverApplied(s.id), voidOf(s.id, created)));
      const hash = first.extra.diffHash as string;
      for (const tier of ['helper', 'bearer', 'impersonating'] as const) {
        const e = await refusal(write(tier, neverApplied(s.id), voidOf(s.id, created, hash)));
        expect(e.code).toBe('OWNER_ONLY');
        expect(e.status).toBe(403);
      }
      expect(getSprayEvent(s.id)).toBeDefined();
      expect(listHoldCorrections(s.id)).toEqual([]);
    });
  });

  it('is refused 48 hours after the entry was made', async () => {
    await inFarm(async () => {
      const s = await guardedSpray(1);
      const created = Date.now() - 48 * HOUR - 1000;
      const first = await refusal(write('owner', neverApplied(s.id), voidOf(s.id, created)));
      expect(first.extra.canVoid).toBe(false);
      const e = await refusal(
        write('owner', neverApplied(s.id), voidOf(s.id, created, first.extra.diffHash as string))
      );
      expect(e.code).toBe('VOID_TOO_LATE');
    });
  });

  it('never shortens a hold from an unknown label', async () => {
    await inFarm(async () => {
      const s = await guardedSpray(1, 'guard-unsourced');
      const created = recordedAtOf('spray', s.id)!;
      const first = await refusal(write('owner', neverApplied(s.id), voidOf(s.id, created)));
      expect(first.extra.canVoid).toBe(false);
      const e = await refusal(
        write('owner', neverApplied(s.id), voidOf(s.id, created, first.extra.diffHash as string))
      );
      expect(e.code).toBe('HOLD_NOT_VOIDABLE');
      expect(e.status).toBe(403);
    });
  });
});

describe('C-35 §5 void routes', () => {
  async function voidSpray(id: string, body: Record<string, unknown>, locals = {}) {
    return call(VOID_SPRAY, `/spray/records/${id}/void`, body, { params: { id }, locals });
  }

  it('refuses a helper, an API token and an impersonating superadmin', async () => {
    await inFarm(async () => {
      const s = await guardedSpray(1);
      m.role = 'helper';
      expect(await voidSpray(s.id, { reason: 'mistake' })).toMatchObject({
        status: 403,
        body: { code: 'OWNER_ONLY' }
      });
      m.role = 'owner';
      expect(await voidSpray(s.id, { reason: 'mistake' }, { authVia: 'bearer' })).toMatchObject({
        status: 403,
        body: { code: 'OWNER_ONLY' }
      });
      m.impersonating = true;
      expect(await voidSpray(s.id, { reason: 'mistake' })).toMatchObject({
        status: 403,
        body: { code: 'OWNER_ONLY' }
      });
      expect(getSprayEvent(s.id)).toBeDefined();
    });
  });

  it('needs a reason, answers 404 for a record that is not there, and voids a fresh spray', async () => {
    await inFarm(async () => {
      const s = await guardedSpray(1);
      expect((await voidSpray(s.id, {})).status).toBe(400);
      expect((await voidSpray('nope', { reason: 'mistake' })).status).toBe(404);
      const first = await voidSpray(s.id, { reason: 'Wrong paddock' });
      expect(first.status).toBe(409);
      expect(first.body.code).toBe('HOLD_WOULD_SHORTEN');
      const stale = await voidSpray(s.id, {
        reason: 'Wrong paddock',
        confirmShorten: '0'.repeat(64)
      });
      expect(stale.body.code).toBe('HOLD_DIFF_STALE');
      const done = await voidSpray(s.id, {
        reason: 'Wrong paddock',
        confirmShorten: first.body.diffHash
      });
      expect(done).toMatchObject({ status: 200, body: { voided: s.id, kind: 'spray' } });
      expect(getSprayEvent(s.id)).toBeUndefined();
      expect(listHoldCorrections(s.id)).toHaveLength(1);
      const tomb = db
        .select()
        .from(recordDeletions)
        .where(withTenant(recordDeletions, eq(recordDeletions.recordId, s.id)))
        .all();
      expect(tomb).toHaveLength(1);
    });
  });

  it('cannot void a spray saved before C-35 (no save time on record)', async () => {
    await inFarm(async () => {
      const s = spray(farm, Date.now() - DAY);
      db.update(sprayEvents)
        .set({ holdParamsJson: null })
        .where(withTenant(sprayEvents, eq(sprayEvents.id, s.id)))
        .run();
      expect(await voidSpray(s.id, { reason: 'mistake' })).toMatchObject({
        status: 409,
        body: { code: 'VOID_TOO_LATE' }
      });
    });
  });

  it('a never-applied DELETE cannot void an application saved before C-35, whatever its date (review round 1)', async () => {
    async function del(handler: unknown, path: string, id: string, query: string) {
      const url = new URL(`http://localhost/api${path}?${query}`);
      const res = await (handler as (e: never) => Promise<Response>)({
        params: { id },
        url,
        request: new Request(url.href, { method: 'DELETE' }),
        locals: {}
      } as never);
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    }
    await inFarm(async () => {
      {
        const s = spray(farm, Date.now() + 3 * DAY);
        const ins = insertInsecticideEvent({
          blockId: farm.blockId,
          performedById: TEST_USER,
          occurredAt: Date.now() - 2 * HOUR,
          products: [{ pluginId: 'guard-known', displayName: 'Known label', iracGroups: ['1A'] }],
          conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
          rulesVersion: 'test',
          pluginHashes: {}
        });
        expect(recordedAtOf('spray', s.id)).toBeNull();
        expect(recordedAtOf('insecticide', ins.id)).toBeNull();
        for (const [handler, path, id] of [
          [DELETE_SPRAY, `/spray/records/${s.id}`, s.id],
          [DELETE_INSECTICIDE, `/insecticide/${ins.id}`, ins.id]
        ] as const) {
          const first = await del(handler, path, id, 'neverApplied=true&reason=mistake');
          expect(first.status).toBe(409);
          expect(first.body.code).toBe('VOID_TOO_LATE');
          expect(first.body.canVoid).toBe(false);
          const again = await del(
            handler,
            path,
            id,
            `neverApplied=true&reason=mistake&confirmShorten=${first.body.diffHash}`
          );
          expect(again.status).toBe(409);
          expect(again.body.code).toBe('VOID_TOO_LATE');
          expect(listHoldCorrections(id)).toEqual([]);
        }
        expect(getSprayEvent(s.id)).toBeDefined();
        expect(getInsecticideEvent(ins.id)).toBeDefined();
      }
    });
  });

  it('voids a fresh move whose stay held the flock’s eggs', async () => {
    await inFarm(async () => {
      await guardedSpray(3);
      const subject = { subjectType: 'group' as const, subjectId: farm.groupId };
      const stay = await write('owner', () =>
        insertStay({ subject, fieldId: farm.pastureId, atMs: Date.now() - 2 * DAY, movedBy: null })
      );
      if (!stay.ok) throw new Error('stay not saved');
      const id = stay.location.id;
      const first = await call(
        VOID_LOCATION,
        `/animals/locations/${id}/void`,
        { reason: 'Wrong flock' },
        { params: { id } }
      );
      expect(first.status).toBe(409);
      expect(first.body.code).toBe('HOLD_WOULD_SHORTEN');
      const done = await call(
        VOID_LOCATION,
        `/animals/locations/${id}/void`,
        { reason: 'Wrong flock', confirmShorten: first.body.diffHash },
        { params: { id } }
      );
      expect(done.status).toBe(200);
      expect(listHoldCorrections(id)).toHaveLength(1);
      expect(listLocationsForSubject('group', farm.groupId).at(-1)?.fieldId).toBe(farm.barnId);
    });
  });

  it('refuses a health or insecticide void from a helper', async () => {
    await inFarm(async () => {
      m.role = 'helper';
      expect(
        await call(VOID_HEALTH, '/animals/health/x/void', { reason: 'x' }, { params: { id: 'x' } })
      ).toMatchObject({ status: 403, body: { code: 'OWNER_ONLY' } });
      expect(
        await call(
          VOID_INSECTICIDE,
          '/insecticide/x/void',
          { reason: 'x' },
          { params: { id: 'x' } }
        )
      ).toMatchObject({ status: 403, body: { code: 'OWNER_ONLY' } });
    });
  });
});

describe('C-35 §3 farm plugin copies', () => {
  it('refuses a farm copy that shortens a hold field (PLUGIN_SHORTENS_HOLD)', async () => {
    await inFarm(async () => {
      const res = await call(UPLOAD_PLUGIN, '/plugins/upload', {
        plugin: {
          pluginId: 'guard-known',
          type: 'herbicide',
          displayName: 'Known label',
          version: '1.0.1',
          activeIngredients: [],
          grazingRestrictions: {
            source: 'farm copy',
            grazeDays: 3,
            hayDays: 10,
            lactatingDairyGrazeDays: 10,
            meatAnimalRemovalBeforeSlaughterDays: 3
          }
        }
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PLUGIN_SHORTENS_HOLD');
      expect(res.body.error).toMatch(/grazingRestrictions\.grazeDays: 10 → 3/);
    });
  });
});

describe('C-35 the farm clock (review round 1)', () => {
  const OWNER_ACCOUNT = 'hold-guard-owner-account';
  const ZONES = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf(
    'timeZone'
  );

  function ownFarm(timeZone: string) {
    db.insert(users)
      .values({ id: OWNER_ACCOUNT, email: 'owner-account@test.local', timeZone })
      .onConflictDoUpdate({ target: users.id, set: { timeZone } })
      .run();
    db.insert(helperAssignments)
      .values({ ownerId, userId: OWNER_ACCOUNT, roleWithinOwner: 'owner', status: 'active' })
      .onConflictDoNothing()
      .run();
  }

  /** A clock, a spray time and a zone: the spray's 10-day hay hold runs
   *  past the clock in New York, and `pick` chooses the zone from every
   *  zone's clear time. Searched rather than fixed, since zones only differ
   *  by where their midnights fall against the clock. */
  function scenario(
    pick: (clears: Array<[string, number]>, nyClear: number, nowMs: number) => string | undefined
  ) {
    const start = Date.now() - 5 * 60_000;
    for (let i = 0; i < 48; i++) {
      const nowMs = start - i * 30 * 60_000;
      for (let m = 10; m < 24 * 60; m += 50) {
        const applied = nowMs - 10 * DAY - m * 60_000;
        const ny = roundedClearMs(applied, 10, TZ);
        if (ny < nowMs + HOUR) continue;
        const clears = ZONES.map((z): [string, number] => [z, roundedClearMs(applied, 10, z)]);
        const zone = pick(clears, ny, nowMs);
        if (zone) return { nowMs, applied, zone, zoneClear: roundedClearMs(applied, 10, zone) };
      }
    }
    throw new Error('no zone found');
  }

  it('rounds holds in the owning account’s zone, whatever zone the writer saved', async () => {
    await inFarm(async () => {
      ownFarm(TZ);
      expect(farmTimeZone()).toBe(TZ);
      const { nowMs, applied, zone, zoneClear } = scenario(
        (clears, _ny, now) => clears.find(([, c]) => c + 60_000 <= now - 2 * 60_000)?.[0]
      );
      await write('owner', () => spray(farm, applied, 'guard-known'), { nowMs });
      db.update(users).set({ timeZone: zone }).where(eq(users.id, TEST_USER)).run();
      expect(farmTimeZone()).toBe(TZ);
      const hay = () =>
        createCutting({
          blockId: farm.blockId,
          cropPluginId: 'hay',
          year: 2026,
          mowAt: zoneClear + 60_000,
          rulesVersion: 'test'
        });
      for (const tier of ['helper', 'owner'] as const) {
        const e = await refusal(write(tier, hay, { nowMs }));
        expect(e.code).toBe('HOLD_ACTIVE');
      }
    });
  });

  it('refuses an owner zone change that would end a running hold earlier, not one that lengthens it', async () => {
    await inFarm(async () => {
      ownFarm(TZ);
      const { nowMs, applied, zone } = scenario((clears, ny, now) =>
        clears.some(([, c]) => c > ny)
          ? clears.find(([, c]) => c > now + 10 * 60_000 && c < ny)?.[0]
          : undefined
      );
      await write('owner', () => spray(farm, applied, 'guard-known'), { nowMs });
      expect(await zoneChangeShortensHolds(TZ, zone, nowMs)).toBe(true);
      const nyClear = roundedClearMs(applied, 10, TZ);
      const later = ZONES.find((z) => roundedClearMs(applied, 10, z) > nyClear)!;
      expect(await zoneChangeShortensHolds(TZ, later, nowMs)).toBe(false);
      expect(await zoneChangeShortensHolds(TZ, TZ, nowMs)).toBe(false);
    });
  });

  it('checks every farm inside the save, so a hold written while another farm loads still counts (review round 5)', async () => {
    await inFarm(async () => {
      ownFarm(TZ);
    });
    const other = seedOwner();
    db.insert(helperAssignments)
      .values({ ownerId: other, userId: OWNER_ACCOUNT, roleWithinOwner: 'owner', status: 'active' })
      .run();
    const { nowMs, applied, zone } = runWithTenant(ownerId, () =>
      scenario((clears, ny, now) =>
        clears.some(([, c]) => c > ny)
          ? clears.find(([, c]) => c > now + 10 * 60_000 && c < ny)?.[0]
          : undefined
      )
    );
    let calls = 0;
    let written = false;
    m.onRegistry = () => {
      calls += 1;
      if (calls === 3 && !written) {
        written = true;
        runWithTenant(ownerId, () => spray(farm, applied, 'guard-known'));
      }
    };
    let saved = false;
    const result = await changeOwnerZone(OWNER_ACCOUNT, TZ, zone, () => (saved = true), nowMs);
    expect(written).toBe(true);
    expect(result).toBe('shortens');
    expect(saved).toBe(false);
    m.onRegistry = undefined;
    expect(
      await changeOwnerZone(OWNER_ACCOUNT, 'Europe/Paris', zone, () => (saved = true), nowMs)
    ).toBe('stale');
    expect(saved).toBe(false);
  });

  it('judges a write by the zone on file inside its transaction, not the one read before it (review round 8)', async () => {
    await inFarm(async () => {
      ownFarm(TZ);
      const nowMs = Date.now() - 5 * 60_000;
      let found: { applied: number; hayAt: number; zone: string } | undefined;
      for (let mins = 0; mins < 3 * 24 * 60 && !found; mins += 37) {
        const applied = nowMs - 11 * DAY - mins * 60_000;
        const ny = roundedClearMs(applied, 10, TZ);
        const hayAt = ny + 60_000;
        if (hayAt > nowMs - 2 * 60_000) continue;
        const zone = ZONES.find((z) => roundedClearMs(applied, 10, z) > hayAt + 60_000);
        if (zone) found = { applied, hayAt, zone };
      }
      expect(found).toBeDefined();
      const { applied, hayAt, zone } = found!;
      await write('owner', () => spray(farm, applied, 'guard-known'), { nowMs });
      const hay = () =>
        createCutting({
          blockId: farm.blockId,
          cropPluginId: 'hay',
          year: 2026,
          mowAt: hayAt,
          rulesVersion: 'test'
        });
      let changed = false;
      m.onRegistry = () => {
        if (changed) return;
        changed = true;
        db.update(users).set({ timeZone: zone }).where(eq(users.id, OWNER_ACCOUNT)).run();
      };
      const e = await refusal(write('owner', hay, { nowMs }));
      expect(changed).toBe(true);
      expect(e.code).toBe('HOLD_ACTIVE');
      expect(farmTimeZone()).toBe(zone);
    });
  });

  it('prepares again when the shared library reloads while it waits (review round 8)', async () => {
    await inFarm(async () => {
      const { resetRegistry } = await import('$lib/server/registry');
      let resets = 0;
      m.onRegistry = () => {
        if (resets >= 1) return;
        resets += 1;
        resetRegistry();
      };
      const saved = await write('owner', () => spray(farm, Date.now() - DAY, 'guard-known'));
      expect(resets).toBe(1);
      expect(saved).toBeDefined();
      m.onRegistry = () => resetRegistry();
      const e = await refusal(write('owner', () => spray(farm, Date.now() - DAY, 'guard-known')));
      expect(e.code).toBe('PLUGINS_RELOADING');
    });
  });

  it('rebuilds the farm plugin view inside the transaction when a farm copy landed meanwhile (review round 8)', async () => {
    await inFarm(async () => {
      m.rebuilds = 0;
      await write('owner', () => spray(farm, Date.now() - DAY, 'guard-known'));
      expect(m.rebuilds).toBe(0);
      let bumped = false;
      m.onRegistry = () => {
        if (bumped) return;
        bumped = true;
        db.update(owners)
          .set({ pluginOverridesRevision: sql`${owners.pluginOverridesRevision} + 1` })
          .where(eq(owners.id, ownerId))
          .run();
      };
      await write('owner', () => spray(farm, Date.now() - DAY, 'guard-known'));
      expect(bumped).toBe(true);
      expect(m.rebuilds).toBe(1);
    });
  });

  it('refuses a zone change that frees hours of a hold that already cleared (review round 2)', async () => {
    await inFarm(async () => {
      ownFarm(TZ);
      const nowMs = Date.now();
      let found: { applied: number; zone: string } | undefined;
      for (let m = 0; m < 24 * 60 && !found; m += 20) {
        const applied = nowMs - 13 * DAY - m * 60_000;
        const ny = roundedClearMs(applied, 10, TZ);
        const zone = ZONES.find((z) => {
          const c = roundedClearMs(applied, 10, z);
          return c < ny - HOUR;
        });
        if (zone && ny < nowMs - DAY) found = { applied, zone };
      }
      expect(found).toBeDefined();
      await write('owner', () => spray(farm, found!.applied, 'guard-known'), { nowMs });
      expect(await zoneChangeShortensHolds(TZ, found!.zone, nowMs)).toBe(true);
    });
  });
});

describe('C-35 §2 snapshots before a shared-library change (review round 1)', () => {
  const hayEnd = async () => {
    const spans = (await projectActiveFarm(TZ)).projection.holds.get(`area:${farm.pastureId}|hay`);
    return spans?.at(-1)?.toMs ?? null;
  };

  it('a record saved before C-35 keeps the data on file when the shared plugin later shortens', async () => {
    await inFarm(async () => {
      const s = spray(farm, Date.now() - 2 * DAY);
      expect(readHoldParamsFor(s.id)).toBeUndefined();
      const tenDays = await hayEnd();
      expect(tenDays).toBeGreaterThan(Date.now() + 7 * DAY);
      expect(await backfillHoldParamsEverywhere()).toBeGreaterThan(0);
      expect(readHoldParamsFor(s.id)).toBeDefined();
      expect(recordedAtOf('spray', s.id)).toBeNull();
      m.knownDays = 3;
      expect(await hayEnd()).toBe(tenDays);
      expect(await backfillHoldParamsEverywhere()).toBe(0);
    });
  });

  it('without the snapshot the same shared change would shorten the hold', async () => {
    await inFarm(async () => {
      spray(farm, Date.now() - 2 * DAY);
      const tenDays = await hayEnd();
      m.knownDays = 3;
      expect(await hayEnd()).toBeLessThan(tenDays!);
    });
  });
});

describe('C-35 §2 snapshots of products named by owner entries (review round 6)', () => {
  it('the backfill gives a product entry the label data on file, once', async () => {
    await inFarm(async () => {
      const dose = insertHealthEvent({
        subjectType: 'group',
        subjectId: farm.groupId,
        kind: 'deworm',
        productName: 'Unknown wormer',
        administeredAt: Date.now() - 2 * DAY,
        withdrawalClear: null,
        rulesVersion: 'test',
        foodProducingAtRecord: true,
        performedById: TEST_USER,
        vetDirectedWithdrawal: JSON.stringify([
          { kind: 'product', pluginId: 'later-wormer', onLabel: true, enteredAtMs: Date.now() }
        ])
      });
      await backfillHoldParamsEverywhere();
      const params = JSON.parse(readHoldParams('animal-health').get(dose.id) ?? '{}');
      expect(params.products).toEqual({ 'later-wormer': null });
      expect(await backfillHoldParamsEverywhere()).toBe(0);
      db.update(animalHealthEvents)
        .set({
          vetDirectedWithdrawal: JSON.stringify([
            { kind: 'product', pluginId: 'later-wormer', onLabel: true, enteredAtMs: Date.now() },
            { kind: 'product', pluginId: 'other-wormer', onLabel: true, enteredAtMs: Date.now() }
          ])
        })
        .where(withTenant(animalHealthEvents, eq(animalHealthEvents.id, dose.id)))
        .run();
      expect(await backfillHoldParamsEverywhere()).toBeGreaterThan(0);
      const next = JSON.parse(readHoldParams('animal-health').get(dose.id) ?? '{}');
      expect(next.products).toEqual({ 'later-wormer': null, 'other-wormer': null });
      expect(next.product).toEqual(params.product);
    });
  });
});

describe('C-35 §2 snapshots survive a delete (review round 2)', () => {
  const hayEnd = async () => {
    const spans = (await projectActiveFarm(TZ)).projection.holds.get(`area:${farm.pastureId}|hay`);
    return spans?.at(-1)?.toMs ?? null;
  };
  const tombstoneOf = (id: string) =>
    JSON.parse(
      db
        .select()
        .from(recordDeletions)
        .where(withTenant(recordDeletions, eq(recordDeletions.recordId, id)))
        .get()!.snapshotJson
    ) as Record<string, unknown>;

  it('a deleted application keeps its recorded hold when the shared plugin later shortens', async () => {
    await inFarm(async () => {
      const s = await guardedSpray(2);
      const tenDays = await hayEnd();
      await write('owner', () => deleteSprayEvent(s.id, { force: true, tombstone: true }));
      expect(typeof tombstoneOf(s.id).holdParamsJson).toBe('string');
      expect(await hayEnd()).toBe(tenDays);
      m.knownDays = 3;
      await backfillHoldParamsEverywhere();
      expect(await hayEnd()).toBe(tenDays);
    });
  });

  it('a plain delete after the shared plugin shortened is not refused', async () => {
    await inFarm(async () => {
      const s = await guardedSpray(2);
      const tenDays = await hayEnd();
      m.knownDays = 3;
      expect(await hayEnd()).toBe(tenDays);
      await write('owner', () => deleteSprayEvent(s.id, { force: true, tombstone: true }));
      expect(await hayEnd()).toBe(tenDays);
    });
  });

  it('a record saved before C-35 and deleted through the guard gets its snapshot on the tombstone', async () => {
    await inFarm(async () => {
      const s = spray(farm, Date.now() - 2 * DAY);
      const tenDays = await hayEnd();
      await write('owner', () => deleteSprayEvent(s.id, { force: true, tombstone: true }));
      expect(typeof tombstoneOf(s.id).holdParamsJson).toBe('string');
      m.knownDays = 3;
      expect(await hayEnd()).toBe(tenDays);
    });
  });

  it('a tombstone left without a snapshot is backfilled before a shared-library change', async () => {
    await inFarm(async () => {
      const s = spray(farm, Date.now() - 2 * DAY);
      const tenDays = await hayEnd();
      deleteSprayEvent(s.id, { force: true, tombstone: true });
      expect(tombstoneOf(s.id).holdParamsJson).toBeUndefined();
      expect(await backfillHoldParamsEverywhere()).toBeGreaterThan(0);
      expect(typeof tombstoneOf(s.id).holdParamsJson).toBe('string');
      m.knownDays = 3;
      expect(await hayEnd()).toBe(tenDays);
      expect(await backfillHoldParamsEverywhere()).toBe(0);
    });
  });

  it('a never-applied tombstone needs no snapshot', async () => {
    await inFarm(async () => {
      const s = spray(farm, Date.now() - 2 * DAY);
      await backfillHoldParamsEverywhere();
      deleteSprayEvent(s.id, { force: true, tombstone: true, neverApplied: true });
      expect(await backfillHoldParamsEverywhere()).toBe(0);
    });
  });
});

describe('C-35 §2 the registry-wide interval behind unknown holds (review round 2)', () => {
  const hayEnd = async () => {
    const spans = (await projectActiveFarm(TZ)).projection.holds.get(`area:${farm.pastureId}|hay`);
    return spans?.at(-1)?.toMs ?? null;
  };

  it('a shared change that lowers the longest interval does not shorten an unknown hold', async () => {
    await inFarm(async () => {
      m.knownDays = 540;
      await guardedSpray(2, UNKNOWN_HERBICIDE_ID);
      const before = await hayEnd();
      expect(before).toBeGreaterThan(Date.now() + 500 * DAY);
      m.knownDays = 30;
      expect(await hayEnd()).toBe(before);
    });
  });

  it('without a snapshot the same change would shorten it', async () => {
    await inFarm(async () => {
      m.knownDays = 540;
      spray(farm, Date.now() - 2 * DAY, UNKNOWN_HERBICIDE_ID);
      const before = await hayEnd();
      m.knownDays = 30;
      expect(await hayEnd()).toBeLessThan(before!);
    });
  });
});

function readHoldParamsFor(id: string): string | undefined {
  return readHoldParams('spray').get(id);
}
