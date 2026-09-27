// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({ role: 'owner' as string }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: 'records-user', role: m.role });
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
    cattle: { pluginId: 'cattle', displayName: 'Cattle', foodProducingDefault: true },
    dog: { pluginId: 'dog', displayName: 'Dog', foodProducingDefault: false }
  };
  const health: Record<string, object> = {
    'test-wormer': {
      pluginId: 'test-wormer',
      displayName: 'Test Wormer',
      activeIngredients: [{ name: 'testamectin' }],
      labelUses: [{ speciesId: 'chicken', class: 'all', withdrawal: { eggsDays: 3 } }]
    }
  };
  return {
    ...actual,
    getDataKinds: async () => ({
      species: { get: (id: string) => species[id] },
      animalHealth: { get: (id: string) => health[id], has: (id: string) => id in health }
    })
  };
});

import { db } from '$lib/db/client';
import { equipment, owners, recordDeletions, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, tenantValues, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import { createStockItem, listMovementsForItem, receiveLot } from '$lib/db/stock';
import { createCloseout } from '$lib/db/seasonCloseouts';
import { seasonYearOf } from '$lib/server/seasonClose';
import { getHealthEvent } from '$lib/db/animalHealth';
import { coveredLogAlerts, healthPlugins } from '$lib/server/animalRecords';
import { listGrazingAttestations } from '$lib/db/grazingAttestations';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { LOCK_WINDOW_MS } from '$lib/db/recordKinds';
import { RULES_VERSION } from '$lib/safety/version';
import { eq } from 'drizzle-orm';

import { POST as CREATE } from '../+server';
import { POST as CREATE_GROUP } from '../../animal-groups/+server';
import { POST as HEALTH } from './record/+server';
import { DELETE as DELETE_HEALTH } from './[id]/+server';
import { POST as ENTRY } from './[id]/entries/+server';
import { POST as PRODUCTION } from '../production/record/+server';
import { DELETE as DELETE_LOG, PATCH as PATCH_LOG } from '../production/[id]/+server';
import { POST as ATTEST } from '../grazing-attestations/+server';
import { POST as MOVE } from '../move/+server';
import { POST as STATUS } from '../status/+server';

const DAY = 86_400_000;

function seedOwner(): string {
  const id = `records-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: 'records-user', email: 'records@test.local' })
    .onConflictDoNothing()
    .run();
  return id;
}

type Handler = (event: never) => Response | Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function call(
  handler: unknown,
  path: string,
  method: string,
  opts: { params?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: Json }> {
  const url = new URL(`http://localhost/api${path}`);
  try {
    const res = await (handler as Handler)({
      params: opts.params ?? {},
      url,
      request: new Request(url.href, {
        method,
        headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
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

const health = (body: unknown, headers?: Record<string, string>) =>
  call(HEALTH, '/animals/health/record', 'POST', { body, headers });
const entry = (id: string, body: unknown) =>
  call(ENTRY, `/animals/health/${id}/entries`, 'POST', { params: { id }, body });
const produce = (body: unknown, headers?: Record<string, string>) =>
  call(PRODUCTION, '/animals/production/record', 'POST', { body, headers });
const removeHealth = (id: string, query = '') =>
  call(DELETE_HEALTH, `/animals/health/${id}${query}`, 'DELETE', { params: { id } });

async function flock() {
  const res = await call(CREATE_GROUP, '/animal-groups', 'POST', {
    body: { name: 'Layers', speciesId: 'chicken', headCount: 12, members: [{ name: 'Henrietta' }] }
  });
  expect(res.status).toBe(201);
  return { groupId: res.body.group.id as string, henId: res.body.members[0].id as string };
}

const eggs = (groupId: string, use: string, occurredAt?: number) => ({
  subjectType: 'group',
  subjectId: groupId,
  kind: 'eggs',
  quantity: 9,
  unit: 'eggs',
  use,
  ...(occurredAt ? { occurredAt } : {})
});

beforeEach(() => {
  m.role = 'owner';
});

describe('the hen withdrawal and discard journey', () => {
  it('blocks the flock eggs while a treated hen is on hold, and always saves discard', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId, henId } = await flock();
      const treated = await health({
        subjectType: 'animal',
        subjectId: henId,
        kind: 'deworm',
        productName: 'Farm store wormer',
        route: 'oral',
        administeredAt: Date.now() - DAY
      });
      expect(treated.status).toBe(201);
      expect(treated.body.event.rulesVersion).toBe(RULES_VERSION);
      expect(treated.body.withdrawalClear.foods.eggs.status).toBe('unknown');
      expect(treated.body.holds.eggs.status).toBe('unknown');

      const stopped = await produce(eggs(groupId, 'food'));
      expect(stopped.status).toBe(422);
      expect(stopped.body).toMatchObject({
        code: 'WITHDRAWAL_UNKNOWN',
        resubmitAs: 'discard',
        overridable: false
      });
      const discarded = await produce(eggs(groupId, 'discard'));
      expect(discarded.status).toBe(201);

      const added = await entry(treated.body.event.id, {
        kind: 'label',
        food: 'eggs',
        amount: 7,
        unit: 'days',
        labelNamesSpeciesAndClass: true
      });
      expect(added.status).toBe(201);
      expect(added.body.holds.eggs.status).toBe('hold');

      const dated = await produce(eggs(groupId, 'sale'));
      expect(dated.status).toBe(422);
      expect(dated.body.code).toBe('WITHDRAWAL_ACTIVE');
      expect(dated.body.clearsOn).toMatch(/\d{4}/);
      expect(dated.body.clearsAtMs).toBeGreaterThanOrEqual(Date.now() + 5 * DAY);

      m.role = 'helper';
      const helper = await produce(eggs(groupId, 'food'));
      expect(helper.status).toBe(422);
      expect(helper.body.overridable).toBe(false);
      expect((await produce(eggs(groupId, 'discard'))).status).toBe(201);
    });
  });

  it('clears the eggs once a sourced label withdrawal has run out', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId } = await flock();
      const t = await health({
        subjectType: 'group',
        subjectId: groupId,
        kind: 'deworm',
        productPluginId: 'test-wormer',
        labelUse: 'label',
        route: 'oral',
        administeredAt: Date.now() - 10 * DAY
      });
      expect(t.body.withdrawalClear.foods.eggs.status).toBe('until');
      expect((await produce(eggs(groupId, 'food'))).status).toBe(201);
      expect((await produce(eggs(groupId, 'food', Date.now() - 9 * DAY))).status).toBe(422);
    });
  });

  it('warns but saves feed-to-animals and unknown uses (C-08)', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId, henId } = await flock();
      await health({
        subjectType: 'animal',
        subjectId: henId,
        kind: 'treatment',
        productName: 'Something',
        administeredAt: Date.now()
      });
      const fed = await produce(eggs(groupId, 'feed-to-animals'));
      expect(fed.status).toBe(201);
      expect(fed.body.warnings[0].code).toBe('FOOD_USE_WARNING');
      expect((await produce(eggs(groupId, 'unknown'))).body.warnings[0].code).toBe(
        'FOOD_USE_WARNING'
      );
    });
  });

  it('tells the owner which saved food logs a backdated treatment covers (C-06)', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId, henId } = await flock();
      const sold = await produce(eggs(groupId, 'sale', Date.now() - DAY));
      expect(sold.status).toBe(201);
      const t = await health({
        subjectType: 'animal',
        subjectId: henId,
        kind: 'treatment',
        productName: 'Something',
        administeredAt: Date.now() - 3 * DAY
      });
      expect(t.status).toBe(201);
      expect(t.body.coveredLogs.map((l: Json) => l.id)).toEqual([sold.body.log.id]);
      expect(t.body.warnings.find((w: Json) => w.code === 'LOGS_COVERED').message).toContain(
        'tell the buyer'
      );
      const alerts = coveredLogAlerts(await healthPlugins(), 'America/New_York');
      expect(alerts).toEqual([
        { subjectType: 'group', subjectId: groupId, name: 'Layers', count: 1, meatCount: 0 }
      ]);
      expect(
        coveredLogAlerts(await healthPlugins(), 'America/New_York', Date.now() + 15 * DAY)
      ).toEqual([]);
    });
  });

  // 110 sequential writes, each checked against the whole farm's hold ledger (C-35).
  it('finds the newest treatment even after more than 50 other records (C-06)', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId, henId } = await flock();
      for (let i = 0; i < 55; i += 1) {
        await health({
          subjectType: 'animal',
          subjectId: henId,
          kind: 'note',
          notes: `check ${i}`,
          administeredAt: Date.now() - 20 * DAY
        });
      }
      for (let i = 0; i < 55; i += 1) {
        await health({
          subjectType: 'group',
          subjectId: groupId,
          kind: 'vaccination',
          productPluginId: 'test-wormer',
          labelUse: 'label',
          administeredAt: Date.now() - 20 * DAY
        });
      }
      const sold = await produce(eggs(groupId, 'sale', Date.now() - DAY));
      expect(sold.status).toBe(201);
      await health({
        subjectType: 'animal',
        subjectId: henId,
        kind: 'treatment',
        productName: 'Something',
        administeredAt: Date.now() - 3 * DAY
      });
      expect(coveredLogAlerts(await healthPlugins(), 'America/New_York')).toEqual([
        { subjectType: 'group', subjectId: groupId, name: 'Layers', count: 1, meatCount: 0 }
      ]);
    });
  }, 20_000);

  it('marks a log saved more than 48 hours late', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId } = await flock();
      const late = await produce(eggs(groupId, 'food', Date.now() - 4 * DAY));
      expect(late.body.warnings[0]).toMatchObject({ code: 'LOGGED_LATE' });
    });
  });

  it('replays a queued log exactly once', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId } = await flock();
      const headers = { [CLIENT_RECORD_HEADER]: `replay-${randomUUID()}` };
      expect((await produce(eggs(groupId, 'discard'), headers)).status).toBe(201);
      const again = await produce(eggs(groupId, 'discard'), headers);
      expect(again.status).toBe(200);
      expect(again.body.duplicate).toBe(true);
    });
  });
});

describe('prohibited drugs (21 CFR 530.41)', () => {
  it('blocks eggs forever after enrofloxacin, and a label entry cannot clear it', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId } = await flock();
      const t = await health({
        subjectType: 'group',
        subjectId: groupId,
        kind: 'treatment',
        productName: 'Enrofloxacin in the water',
        route: 'drinking-water',
        administeredAt: Date.now() - 399 * DAY
      });
      expect(t.body.withdrawalClear.foods.eggs.status).toBe('prohibited');
      const stop = await produce(eggs(groupId, 'food'));
      expect(stop.body.code).toBe('PROHIBITED_DRUG');
      const refused = await entry(t.body.event.id, {
        kind: 'label',
        food: 'eggs',
        amount: 0,
        unit: 'days',
        labelNamesSpeciesAndClass: true,
        labelSaysNone: true
      });
      expect(refused.status === 201 ? refused.body.holds.eggs.status : 'prohibited').toBe(
        'prohibited'
      );
      expect((await produce(eggs(groupId, 'food'))).status).toBe(422);
    });
  });
});

describe('the owner and the vet-directed withdrawal (persona, Q11)', () => {
  it('lets only the owner enter the vet number, and never the label path for extra-label use', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const cow = await call(CREATE, '/animals', 'POST', {
        body: { speciesId: 'cattle', name: 'Clover', sex: 'female' }
      });
      const cowId = cow.body.animal.id;
      const t = await health({
        subjectType: 'animal',
        subjectId: cowId,
        kind: 'treatment',
        productName: 'Vet-prescribed antibiotic',
        route: 'injection-im',
        labelUse: 'extra-label-vet',
        vetName: 'Dr. Reyes',
        administeredAt: Date.now() - DAY
      });
      expect(t.status).toBe(201);
      const id = t.body.event.id;

      m.role = 'helper';
      const helper = await entry(id, {
        kind: 'vet',
        food: 'milk',
        amount: 96,
        unit: 'hours',
        vetName: 'Dr. Reyes'
      });
      expect(helper.status).toBe(403);
      expect((await removeHealth(id)).status).toBe(403);

      m.role = 'owner';
      const label = await entry(id, {
        kind: 'label',
        food: 'milk',
        amount: 48,
        unit: 'hours',
        labelNamesSpeciesAndClass: true
      });
      expect(label.status).toBe(409);
      expect(label.body.code).toBe('LABEL_PATH_CLOSED');
      const vet = await entry(id, {
        kind: 'vet',
        food: 'milk',
        amount: 96,
        unit: 'hours',
        vetName: 'Dr. Reyes'
      });
      expect(vet.status).toBe(201);
      expect(vet.body.holds.milk.status).toBe('hold');
      expect(vet.body.holds.milk.clearsAtMs).toBeGreaterThanOrEqual(
        t.body.event.administeredAt + 96 * 3_600_000
      );
      expect(getHealthEvent(id)?.vetDirectedWithdrawal).toContain('Dr. Reyes');
    });
  });

  it('refuses extra-label use with no vet named', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const cow = await call(CREATE, '/animals', 'POST', {
        body: { speciesId: 'cattle', name: 'Bess' }
      });
      const res = await health({
        subjectType: 'animal',
        subjectId: cow.body.animal.id,
        kind: 'treatment',
        productName: 'Something',
        labelUse: 'extra-label-vet',
        administeredAt: Date.now()
      });
      expect(res.status).toBe(400);
    });
  });
});

describe('who answers the label-use question (C-10, C-19)', () => {
  it('a helper\'s "as the label says" never shortens the hold; the owner confirms it', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId } = await flock();
      m.role = 'helper';
      const t = await health({
        subjectType: 'group',
        subjectId: groupId,
        kind: 'deworm',
        productPluginId: 'test-wormer',
        labelUse: 'label',
        route: 'oral',
        administeredAt: Date.now() - 5 * DAY
      });
      expect(t.status).toBe(201);
      expect(t.body.event.labelUse).toBe('unknown');
      expect(t.body.withdrawalClear.foods.eggs.status).toBe('unknown');
      expect(t.body.warnings.map((w: Json) => w.code)).toContain('LABEL_USE_OWNER');
      const stop = await produce(eggs(groupId, 'food'));
      expect(stop.status).toBe(422);
      expect(stop.body.code).toBe('WITHDRAWAL_UNKNOWN');

      m.role = 'owner';
      const confirmed = await entry(t.body.event.id, {
        kind: 'product',
        pluginId: 'test-wormer',
        onLabel: true
      });
      expect(confirmed.status).toBe(201);
      expect(confirmed.body.withdrawalClear.foods.eggs.status).toBe('until');
      expect((await produce(eggs(groupId, 'food'))).status).toBe(201);
    });
  });

  it("keeps the record's own write-time verdict and rules version when an entry is added", async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId } = await flock();
      const t = await health({
        subjectType: 'group',
        subjectId: groupId,
        kind: 'deworm',
        productName: 'Farm store wormer',
        administeredAt: Date.now() - DAY
      });
      const before = getHealthEvent(t.body.event.id)!;
      const added = await entry(t.body.event.id, {
        kind: 'vet',
        food: 'eggs',
        amount: 5,
        unit: 'days',
        vetName: 'Dr. Reyes'
      });
      expect(added.status).toBe(201);
      const after = getHealthEvent(t.body.event.id)!;
      expect(after.withdrawalClear).toBe(before.withdrawalClear);
      expect(after.rulesVersion).toBe(before.rulesVersion);
      const entries = JSON.parse(after.vetDirectedWithdrawal!);
      expect(entries[0].verdict.foods.eggs.status).toBe('until');
      expect(entries[0].verdict.rulesVersion).toBe(RULES_VERSION);
    });
  });
});

describe('the household vet visit journey', () => {
  it('never locks or holds a dog vet visit, and a helper can remove it', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const dog = await call(CREATE, '/animals', 'POST', {
        body: { speciesId: 'dog', name: 'Rex' }
      });
      const visit = await health({
        subjectType: 'animal',
        subjectId: dog.body.animal.id,
        kind: 'vet-visit',
        vetName: 'Dr. Lane',
        notes: 'Annual check',
        administeredAt: Date.now() - 5 * DAY
      });
      expect(visit.status).toBe(201);
      expect(visit.body.carriesHold).toBe(false);
      expect(visit.body.locksOnSave).toBe(false);
      expect(visit.body.holds).toEqual({
        meat: { status: 'clear' },
        milk: { status: 'clear' },
        eggs: { status: 'clear' }
      });
      m.role = 'helper';
      expect((await removeHealth(visit.body.event.id)).status).toBe(200);
    });
  });
});

describe('the 48 hour lock and tombstones (FR-09, C-20, C-26)', () => {
  it('locks an old food-animal treatment, keeps its hold after a forced delete, and drops it only when never given', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId, henId } = await flock();
      const old = await health({
        subjectType: 'animal',
        subjectId: henId,
        kind: 'treatment',
        productName: 'Old dose',
        administeredAt: Date.now() - 3 * DAY
      });
      expect(old.body.locksOnSave).toBe(true);
      const id = old.body.event.id;
      expect((await removeHealth(id)).body.code).toBe('RECORD_LOCKED');
      m.role = 'helper';
      expect((await removeHealth(id, '?force=true&reason=typo')).status).toBe(403);
      m.role = 'owner';
      expect((await removeHealth(id, '?force=true')).body.code).toBe('REASON_REQUIRED');
      const forced = await removeHealth(id, '?force=true&reason=wrong+animal');
      expect(forced.status).toBe(200);
      expect(forced.body.holdKept).toBe(true);
      expect(getHealthEvent(id)).toBeUndefined();
      expect((await produce(eggs(groupId, 'food'))).status).toBe(422);

      const second = await health({
        subjectType: 'animal',
        subjectId: henId,
        kind: 'treatment',
        productName: 'Typo dose',
        administeredAt: Date.now() - 3 * DAY
      });
      await removeHealth(second.body.event.id, '?force=true&neverGiven=true&reason=never+given');
      const tombstones = db
        .select()
        .from(recordDeletions)
        .where(withTenant(recordDeletions, eq(recordDeletions.recordKind, 'animal-health')))
        .all();
      expect(tombstones).toHaveLength(2);
    });
  });

  it('refuses a never-given delete that would shorten an unknown hold (C-35)', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId, henId } = await flock();
      const t = await health({
        subjectType: 'animal',
        subjectId: henId,
        kind: 'treatment',
        productName: 'Wrong hen',
        administeredAt: Date.now() - 3 * DAY
      });
      expect((await produce(eggs(groupId, 'food'))).status).toBe(422);
      // C-35 §5: dropping a hold is a void, and a hold from an unknown label
      // is never voidable. The dose stays and keeps its hold.
      const never = await removeHealth(
        t.body.event.id,
        '?force=true&neverGiven=true&reason=wrong+hen'
      );
      expect(never.status).toBe(403);
      expect(never.body.code).toBe('HOLD_NOT_VOIDABLE');
      expect((await produce(eggs(groupId, 'food'))).status).toBe(422);
    });
  });

  it('allows a downgrade to discard on a locked log and gates the other way', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId, henId } = await flock();
      const log = await produce(eggs(groupId, 'food', Date.now() - 3 * DAY));
      const id = log.body.log.id;
      m.role = 'helper';
      const down = await call(PATCH_LOG, `/animals/production/${id}`, 'PATCH', {
        params: { id },
        body: { use: 'discard' }
      });
      expect(down.status).toBe(200);
      expect(down.body.log.use).toBe('discard');
      const up = await call(PATCH_LOG, `/animals/production/${id}`, 'PATCH', {
        params: { id },
        body: { use: 'food' }
      });
      expect(up.body.code).toBe('RECORD_LOCKED');

      m.role = 'owner';
      const fresh = await produce(eggs(groupId, 'discard'));
      await health({
        subjectType: 'animal',
        subjectId: henId,
        kind: 'treatment',
        productName: 'Something',
        administeredAt: Date.now() - DAY
      });
      const gated = await call(PATCH_LOG, `/animals/production/${fresh.body.log.id}`, 'PATCH', {
        params: { id: fresh.body.log.id },
        body: { use: 'food' }
      });
      expect(gated.status).toBe(422);
      const lockedDelete = await call(DELETE_LOG, `/animals/production/${id}`, 'DELETE', {
        params: { id }
      });
      expect(lockedDelete.body.code).toBe('RECORD_LOCKED');
    });
  });

  it('keeps a pet record editable after 48 hours', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const dog = await call(CREATE, '/animals', 'POST', {
        body: { speciesId: 'dog', name: 'Pip' }
      });
      const t = await health({
        subjectType: 'animal',
        subjectId: dog.body.animal.id,
        kind: 'deworm',
        productName: 'Dog wormer',
        administeredAt: Date.now() - LOCK_WINDOW_MS - DAY
      });
      expect(t.body.locksOnSave).toBe(false);
      expect((await removeHealth(t.body.event.id)).status).toBe(200);
    });
  });
});

describe('stock (C-34)', () => {
  it('takes the dose off stock as an animal-treatment movement, or warns when the units differ', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId } = await flock();
      const item = createStockItem({
        category: 'adjuvant',
        displayName: 'Poultry wormer',
        defaultUnit: 'fl-oz'
      });
      receiveLot({ stockItemId: item.id, receivedQuantity: 16, unit: 'fl-oz' });
      const ok = await health({
        subjectType: 'group',
        subjectId: groupId,
        kind: 'deworm',
        stockItemId: item.id,
        dose: 2,
        doseUnit: 'fl-oz',
        administeredAt: Date.now()
      });
      expect(ok.status).toBe(201);
      expect(ok.body.event.productName).toBe('Poultry wormer');
      const moves = listMovementsForItem(item.id);
      const treatment = moves.find((mv) => mv.reason === 'animal-treatment');
      expect(treatment?.delta).toBe(-2);
      expect(treatment?.notes).toBe(`animal-health:${ok.body.event.id}`);

      const ml = await health({
        subjectType: 'group',
        subjectId: groupId,
        kind: 'deworm',
        stockItemId: item.id,
        dose: 5,
        doseUnit: 'mL',
        administeredAt: Date.now()
      });
      expect(ml.status).toBe(201);
      expect(ml.body.warnings[0].code).toBe('STOCK_NOT_DEDUCTED');
    });
  });
});

describe('tenant isolation and season close', () => {
  it("rejects another Owner's animal and stock item", async () => {
    const other = seedOwner();
    const theirs = await runWithTenantAsync(other, async () => {
      const f = await flock();
      const item = createStockItem({ category: 'adjuvant', displayName: 'X', defaultUnit: 'oz' });
      return { ...f, itemId: item.id };
    });
    await runWithTenantAsync(seedOwner(), async () => {
      const mine = await flock();
      expect(
        (
          await health({
            subjectType: 'group',
            subjectId: theirs.groupId,
            kind: 'note',
            administeredAt: Date.now()
          })
        ).body.code
      ).toBe('UNKNOWN_SUBJECT');
      expect(
        (
          await health({
            subjectType: 'group',
            subjectId: mine.groupId,
            kind: 'deworm',
            stockItemId: theirs.itemId,
            administeredAt: Date.now()
          })
        ).status
      ).toBe(400);
      expect((await produce(eggs(theirs.groupId, 'discard'))).body.code).toBe('UNKNOWN_SUBJECT');
    });
  });

  it('keeps health and production open in a closed season', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      createCloseout({ year: seasonYearOf(Date.now()), snapshotJson: '{}' });
      const { groupId } = await flock();
      expect(
        (
          await health({
            subjectType: 'group',
            subjectId: groupId,
            kind: 'note',
            notes: 'Molting',
            administeredAt: Date.now()
          })
        ).status
      ).toBe(201);
      expect((await produce(eggs(groupId, 'food'))).status).toBe(201);
    });
  });
});

describe('grazing attestations (C-27)', () => {
  function seedSpray(ownerId: string) {
    return runWithTenant(ownerId, () => {
      const pasture = createField({ name: 'North pasture', kind: 'pasture' });
      const block = createBlock({ name: 'Paddock', fieldId: pasture.id, acres: 1 });
      db.insert(equipment)
        .values(tenantValues({ id: `${ownerId}-s`, type: 'sprayer' as const, label: 'S' }))
        .run();
      const spray = insertSprayEvent({
        blockId: block.id,
        sprayerId: `${ownerId}-s`,
        performedById: 'records-user',
        occurredAt: Date.now() - 2 * DAY,
        products: [{ pluginId: 'no-such-plugin', chemistryClasses: ['glyphosate'] }],
        conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
        rulesVersion: 'test',
        pluginHashes: {}
      });
      return { fieldId: pasture.id, ref: `spray:${spray.id}` };
    });
  }

  it('is owner only, checks the application is on the Area, and saves manual rows', async () => {
    const ownerId = seedOwner();
    const s = seedSpray(ownerId);
    await runWithTenantAsync(ownerId, async () => {
      const body = {
        fieldId: s.fieldId,
        reason: 'Read the label on the jug',
        items: [{ sprayEventRef: s.ref, grazeDays: 14, hayDays: 30 }]
      };
      m.role = 'helper';
      expect((await call(ATTEST, '/animals/grazing-attestations', 'POST', { body })).status).toBe(
        403
      );
      m.role = 'owner';
      const other = createField({ name: 'South', kind: 'pasture' });
      const wrong = await call(ATTEST, '/animals/grazing-attestations', 'POST', {
        body: { ...body, fieldId: other.id }
      });
      expect(wrong.body.code).toBe('UNKNOWN_APPLICATION');
      const ok = await call(ATTEST, '/animals/grazing-attestations', 'POST', { body });
      expect(ok.status).toBe(201);
      expect(ok.body.attestations[0]).toMatchObject({
        provenance: 'manual',
        grazeDays: 14,
        attestedBy: 'records-user',
        productPluginId: 'no-such-plugin'
      });
      expect(listGrazingAttestations({ fieldIds: [s.fieldId] })).toHaveLength(1);
    });
  });

  it("rejects another Owner's Area", async () => {
    const theirs = seedSpray(seedOwner());
    await runWithTenantAsync(seedOwner(), async () => {
      const res = await call(ATTEST, '/animals/grazing-attestations', 'POST', {
        body: {
          fieldId: theirs.fieldId,
          reason: 'x',
          items: [{ sprayEventRef: theirs.ref, grazeDays: 1 }]
        }
      });
      expect(res.status).toBe(400);
    });
  });
});

describe('round 4: the bottle from stock names a prohibited drug (C-13, C-34)', () => {
  it('holds eggs as prohibited whatever name is typed, and from active ingredients alone', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId } = await flock();
      const metro = createStockItem({
        category: 'adjuvant',
        displayName: 'Metronidazole 500 mg',
        defaultUnit: 'fl-oz'
      });
      m.role = 'helper';
      const typed = await health({
        subjectType: 'group',
        subjectId: groupId,
        kind: 'treatment',
        productName: 'Vitamin drench',
        stockItemId: metro.id,
        administeredAt: Date.now() - DAY
      });
      expect(typed.status).toBe(201);
      expect(typed.body.event.productName).toBe('Vitamin drench');
      expect(typed.body.withdrawalClear.foods.eggs.status).toBe('prohibited');

      m.role = 'owner';
      const label = await entry(typed.body.event.id, {
        kind: 'label',
        food: 'eggs',
        amount: 1,
        unit: 'days',
        labelNamesSpeciesAndClass: true
      });
      expect(label.status === 201 ? label.body.holds.eggs.status : 'prohibited').toBe('prohibited');
      const sold = await produce(eggs(groupId, 'food'));
      expect(sold.status).toBe(422);
      expect(sold.body.code).toBe('PROHIBITED_DRUG');

      const tonic = createStockItem({
        category: 'adjuvant',
        displayName: 'Poultry tonic',
        defaultUnit: 'fl-oz',
        activeIngredientsJson: JSON.stringify([{ name: 'metronidazole' }])
      });
      const other = await flock();
      const byIngredient = await health({
        subjectType: 'group',
        subjectId: other.groupId,
        kind: 'treatment',
        stockItemId: tonic.id,
        administeredAt: Date.now() - DAY
      });
      expect(byIngredient.status).toBe(201);
      expect(byIngredient.body.event.productName).toBe('Poultry tonic');
      expect(byIngredient.body.withdrawalClear.foods.eggs).toMatchObject({
        status: 'prohibited',
        cfr: ['21 CFR 530.41(a)(6)']
      });
    });
  });
});

describe('round 4: C-06 reaches split-off groups, meat, and relabelled logs', () => {
  it('lists the logs of a group split off after the treatment', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const coopA = createField({ name: 'Coop A', kind: 'barn' }).id;
      const coopB = createField({ name: 'Coop B', kind: 'barn' }).id;
      const { groupId } = await flock();
      const housed = await call(MOVE, '/animals/move', 'POST', {
        body: {
          subjectType: 'group',
          subjectId: groupId,
          fieldId: coopA,
          movedAt: Date.now() - 10 * DAY
        }
      });
      expect(housed.status).toBe(201);
      const split = await call(MOVE, '/animals/move', 'POST', {
        body: { subjectType: 'group', subjectId: groupId, count: 5, fieldId: coopB }
      });
      expect(split.status).toBe(201);
      const child = split.body.move.newGroup.id as string;
      const sold = await produce(eggs(child, 'sale'));
      expect(sold.status).toBe(201);
      const t = await health({
        subjectType: 'group',
        subjectId: groupId,
        kind: 'treatment',
        productName: 'Wormer X',
        administeredAt: Date.now() - 5 * DAY
      });
      expect(t.status).toBe(201);
      expect(t.body.coveredLogs.map((l: Json) => l.id)).toEqual([sold.body.log.id]);
      expect(t.body.warnings.map((w: Json) => w.code)).toContain('LOGS_COVERED');
      expect((await produce(eggs(child, 'sale'))).body.code).toBe('WITHDRAWAL_UNKNOWN');
      const alerts = coveredLogAlerts(await healthPlugins(), 'America/New_York');
      expect(alerts).toContainEqual(
        expect.objectContaining({ subjectType: 'group', subjectId: child, count: 1 })
      );
    });
  });

  it('warns about meat already declared as food inside a late-recorded hold', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const steer = await call(CREATE, '/animals', 'POST', {
        body: { speciesId: 'cattle', name: 'Steer', sex: 'neutered-male' }
      });
      expect(steer.status).toBe(201);
      const id = steer.body.animal.id as string;
      const sold = await call(STATUS, '/animals/status', 'POST', {
        body: {
          subjectType: 'animal',
          subjectId: id,
          status: 'sold-for-meat',
          occurredAt: Date.now() - DAY
        }
      });
      expect(sold.status).toBe(201);
      const t = await health({
        subjectType: 'animal',
        subjectId: id,
        kind: 'treatment',
        productName: 'Penicillin G',
        route: 'injection-im',
        administeredAt: Date.now() - 3 * DAY
      });
      expect(t.status).toBe(201);
      expect(t.body.coveredMeat.map((e: Json) => e.id)).toEqual([sold.body.event.id]);
      expect(t.body.warnings.map((w: Json) => w.code)).toContain('MEAT_COVERED');
      expect(coveredLogAlerts(await healthPlugins(), 'America/New_York')).toEqual([
        { subjectType: 'animal', subjectId: id, name: 'Steer', count: 0, meatCount: 1 }
      ]);
    });
  });

  it('keeps a relabelled log on the owner alert and owner-only to delete', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { groupId } = await flock();
      const sold = await produce(eggs(groupId, 'sale'));
      const lockedSale = await produce(eggs(groupId, 'sale', Date.now() - 5 * DAY));
      await health({
        subjectType: 'group',
        subjectId: groupId,
        kind: 'treatment',
        productName: 'Some wormer',
        administeredAt: Date.now() - 6 * DAY
      });
      const before = coveredLogAlerts(await healthPlugins(), 'America/New_York');
      expect(before[0].count).toBe(2);

      m.role = 'helper';
      for (const log of [sold, lockedSale]) {
        const id = log.body.log.id as string;
        const relabel = await call(PATCH_LOG, `/animals/production/${id}`, 'PATCH', {
          params: { id },
          body: { use: 'discard' }
        });
        expect(relabel.status).toBe(200);
        expect(relabel.body.log.use).toBe('discard');
        expect(relabel.body.log.declaredUse).toBe('sale');
      }
      const id = sold.body.log.id as string;
      const removed = await call(DELETE_LOG, `/animals/production/${id}`, 'DELETE', {
        params: { id }
      });
      expect(removed.status).toBe(403);
      expect(removed.body.code).toBe('LOG_UNDER_HOLD');
      expect(removed.body.error).not.toContain('discarded instead');
      const after = coveredLogAlerts(await healthPlugins(), 'America/New_York');
      expect(after).toEqual(before);

      m.role = 'owner';
      const owner = await call(DELETE_LOG, `/animals/production/${id}`, 'DELETE', {
        params: { id }
      });
      expect(owner.status).toBe(200);
    });
  });
});
