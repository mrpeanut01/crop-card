// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';

const m = vi.hoisted(() => ({ role: 'owner' as string }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: 'offline-user', role: m.role });
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
  return {
    ...actual,
    getDataKinds: async () => ({
      species: { get: (id: string) => species[id] },
      animalHealth: { get: () => undefined }
    })
  };
});

import { db } from '$lib/db/client';
import {
  animalProductionLogs,
  equipment,
  owners,
  recordDeletions,
  stockMovements,
  users
} from '$lib/db/schema';
import { runWithTenantAsync, tenantValues, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import { getAnimalGroup } from '$lib/db/animalGroups';
import {
  createStockItem,
  getStockItemWithBalance,
  receiveLot,
  type StockCategory
} from '$lib/db/stock';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';

import { POST as MOVE } from './move/+server';
import { POST as PRODUCTION } from './production/record/+server';
import { POST as HEALTH } from './health/record/+server';
import { POST as CREATE_GROUP } from '../animal-groups/+server';
import { POST as FEED_USE } from '../stock/[id]/use/+server';

const DAY = 86_400_000;
const HOUR = 3_600_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function seedOwner(): string {
  const id = `offline-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: 'offline-user', email: 'offline@test.local' })
    .onConflictDoNothing()
    .run();
  return id;
}

async function call(
  handler: unknown,
  path: string,
  body: unknown,
  opts: {
    params?: Record<string, string>;
    recordId?: string;
    locals?: Record<string, unknown>;
  } = {}
): Promise<{ status: number; body: Json }> {
  const url = new URL(`http://localhost/api${path}`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.recordId) headers[CLIENT_RECORD_HEADER] = opts.recordId;
  const res = await (handler as (e: never) => Promise<Response>)({
    params: opts.params ?? {},
    url,
    request: new Request(url.href, { method: 'POST', headers, body: JSON.stringify(body) }),
    locals: opts.locals ?? {}
  } as never);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

function sprayedPasture(daysAgo = 10) {
  const barn = createField({ name: 'Barn', kind: 'barn' });
  const pasture = createField({ name: 'North pasture', kind: 'pasture' });
  const block = createBlock({ name: 'Paddock 1', fieldId: pasture.id, acres: 1 });
  const sprayerId = `sprayer-${randomUUID()}`;
  db.insert(equipment)
    .values(tenantValues({ id: sprayerId, type: 'sprayer' as const, label: 'Backpack' }))
    .run();
  insertSprayEvent({
    blockId: block.id,
    sprayerId,
    performedById: 'offline-user',
    occurredAt: Date.now() - daysAgo * DAY,
    products: [{ pluginId: 'unsourced-weedkiller', chemistryClasses: ['glyphosate'] }],
    conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
    rulesVersion: 'test',
    pluginHashes: {}
  });
  return { barnId: barn.id, pastureId: pasture.id };
}

async function group(species: string, housingFieldId: string | null): Promise<string> {
  const res = await call(CREATE_GROUP, '/animal-groups', {
    name: 'Flock',
    speciesId: species,
    headCount: 6,
    ...(housingFieldId ? { housingFieldId } : {})
  });
  expect(res.status).toBe(201);
  return res.body.group.id;
}

function logsFor(subjectId: string) {
  return db
    .select()
    .from(animalProductionLogs)
    .where(withTenant(animalProductionLogs, eq(animalProductionLogs.subjectId, subjectId)))
    .all();
}

beforeEach(() => {
  m.role = 'owner';
});

describe('a queued move is judged as live (D1-06)', () => {
  it('answers 422 for a queued move two hours old onto a held pasture, and saves it resent without the flag', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture();
      const groupId = await group('sheep', farm.barnId);
      m.role = 'helper';
      const body = {
        subjectType: 'group',
        subjectId: groupId,
        fieldId: farm.pastureId,
        movedAt: Date.now() - 2 * HOUR,
        queuedLive: true
      };
      const id = `rec-${randomUUID()}`;
      const live = await call(MOVE, '/animals/move', body, { recordId: id });
      expect(live.status).toBe(422);
      expect(live.body.code).toBe('GRAZING_UNKNOWN');
      expect(live.body.askOwner).toBe(true);
      expect(getAnimalGroup(groupId)?.housingFieldId).toBe(farm.barnId);

      const { queuedLive: _drop, ...wentThrough } = body;
      const saved = await call(MOVE, '/animals/move', wentThrough, { recordId: id });
      expect(saved.status).toBe(201);
      expect(saved.body.warnings[0]).toContain('because it already happened');

      const again = await call(MOVE, '/animals/move', wentThrough, { recordId: id });
      expect(again.status).toBe(200);
      expect(again.body.duplicate).toBe(true);
    });
  });

  it('saves "they already went through the gate" for a move tapped minutes ago', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture();
      const groupId = await group('sheep', farm.barnId);
      const body = {
        subjectType: 'group',
        subjectId: groupId,
        fieldId: farm.pastureId,
        movedAt: Date.now() - 5 * 60_000,
        queuedLive: true
      };
      const id = `rec-${randomUUID()}`;
      const live = await call(MOVE, '/animals/move', body, { recordId: id });
      expect(live.status).toBe(422);

      const { queuedLive: _drop, ...plain } = body;
      const stillLive = await call(MOVE, '/animals/move', plain, { recordId: id });
      expect(stillLive.status).toBe(422);

      const saved = await call(
        MOVE,
        '/animals/move',
        { ...plain, alreadyThere: true },
        { recordId: id }
      );
      expect(saved.status).toBe(201);
      expect(saved.body.warnings[0]).toContain('because it already happened');

      const ignored = await call(MOVE, '/animals/move', {
        ...body,
        subjectId: await group('sheep', farm.barnId),
        alreadyThere: true
      });
      expect(ignored.status).toBe(422);
    });
  });

  it('does not let alreadyThere skip a live stop outside a phone recovery resend', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const farm = sprayedPasture();
      const now = {
        subjectType: 'group',
        subjectId: await group('sheep', farm.barnId),
        fieldId: farm.pastureId,
        movedAt: Date.now(),
        alreadyThere: true
      };
      const online = await call(MOVE, '/animals/move', now);
      expect(online.status).toBe(422);

      const bearer = await call(MOVE, '/animals/move', now, {
        recordId: `rec-${randomUUID()}`,
        locals: { authVia: 'bearer' }
      });
      expect(bearer.status).toBe(422);

      m.role = 'helper';
      const helper = await call(MOVE, '/animals/move', now, { recordId: `rec-${randomUUID()}` });
      expect(helper.status).toBe(422);
      expect(helper.body.code).toBe('GRAZING_UNKNOWN');
      expect(helper.body.askOwner).toBe(true);

      m.role = 'owner';
      const owner = await call(MOVE, '/animals/move', now, { recordId: `rec-${randomUUID()}` });
      expect(owner.status).toBe(201);
      expect(owner.body.warnings[0]).toContain('because it already happened');
    });
  });

  it('never makes a clear pasture stricter', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const barn = createField({ name: 'Barn', kind: 'barn' });
      const yard = createField({ name: 'Yard', kind: 'pasture' });
      const groupId = await group('sheep', barn.id);
      const res = await call(MOVE, '/animals/move', {
        subjectType: 'group',
        subjectId: groupId,
        fieldId: yard.id,
        movedAt: Date.now() - HOUR,
        queuedLive: true
      });
      expect(res.status).toBe(201);
    });
  });
});

describe('Save as discard after a replayed hold stop (D0-11)', () => {
  it('refuses the queued food log, then saves the same record id once as discarded with an audit entry', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const groupId = await group('chicken', null);
      m.role = 'helper';
      const treated = await call(HEALTH, '/animals/health/record', {
        subjectType: 'group',
        subjectId: groupId,
        kind: 'deworm',
        productName: 'Farm store wormer',
        route: 'oral',
        administeredAt: Date.now() - DAY,
        labelUse: 'unknown'
      });
      expect(treated.status).toBe(201);

      const id = `rec-${randomUUID()}`;
      const eggs = {
        subjectType: 'group',
        subjectId: groupId,
        kind: 'eggs',
        quantity: 12,
        unit: 'eggs',
        use: 'food',
        occurredAt: Date.now() - HOUR
      };
      const stop = await call(PRODUCTION, '/animals/production/record', eggs, { recordId: id });
      expect(stop.status).toBe(422);
      expect(stop.body.resubmitAs).toBe('discard');
      expect(logsFor(groupId)).toHaveLength(0);

      const converted = { ...eggs, use: 'discard', convertedFromUse: 'food' };
      const saved = await call(PRODUCTION, '/animals/production/record', converted, {
        recordId: id
      });
      expect(saved.status).toBe(201);
      const again = await call(PRODUCTION, '/animals/production/record', converted, {
        recordId: id
      });
      expect(again.status).toBe(200);
      expect(again.body.duplicate).toBe(true);

      const logs = logsFor(groupId);
      expect(logs).toHaveLength(1);
      expect(logs[0].use).toBe('discard');
      expect(logs[0].declaredUse).toBeNull();
      const audit = db
        .select()
        .from(recordDeletions)
        .where(
          withTenant(
            recordDeletions,
            and(
              eq(recordDeletions.recordKind, 'animal-production'),
              eq(recordDeletions.recordId, logs[0].id)
            )
          )
        )
        .all();
      expect(audit).toHaveLength(1);
      expect(audit[0].reason).toContain('It was queued as food');
      expect(JSON.parse(audit[0].snapshotJson).action).toBe('offline-convert');
    });
  });

  it('refuses convertedFromUse on anything but a discard', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const groupId = await group('chicken', null);
      const res = await call(PRODUCTION, '/animals/production/record', {
        subjectType: 'group',
        subjectId: groupId,
        kind: 'eggs',
        quantity: 3,
        unit: 'eggs',
        use: 'sale',
        convertedFromUse: 'food'
      });
      expect(res.status).toBe(400);
      expect(logsFor(groupId)).toHaveLength(0);
    });
  });
});

describe('POST /api/stock/:id/use (D1-16, D2-05)', () => {
  function feedItem(opts: { unit?: string; category?: string; lbPerBag?: number } = {}) {
    const item = createStockItem({
      category: (opts.category ?? 'feed') as StockCategory,
      displayName: 'Layer pellets',
      defaultUnit: (opts.unit ?? 'lb') as never,
      ...(opts.lbPerBag
        ? { metadataJson: JSON.stringify({ feed: { lbPerBag: opts.lbPerBag } }) }
        : {})
    });
    receiveLot({ stockItemId: item.id, receivedQuantity: 100, unit: (opts.unit ?? 'lb') as never });
    return item;
  }

  const use = (id: string, body: unknown, recordId?: string) =>
    call(FEED_USE, `/stock/${id}/use`, body, { params: { id }, recordId });

  it('lets a helper take pounds off a feed item once per record id, linked to the flock', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const groupId = await group('chicken', null);
      const item = feedItem();
      m.role = 'helper';
      const id = `rec-${randomUUID()}`;
      const body = { lb: 3, subjectType: 'group', subjectId: groupId };
      const res = await use(item.id, body, id);
      expect(res.status).toBe(201);
      expect(res.body.used).toEqual({ lb: 3, amount: 3, unit: 'lb' });
      const again = await use(item.id, body, id);
      expect(again.status).toBe(200);
      expect(getStockItemWithBalance(item.id)?.onHand).toBe(97);
      const moves = db
        .select()
        .from(stockMovements)
        .where(withTenant(stockMovements, eq(stockMovements.reason, 'animal-feed')))
        .all();
      expect(moves).toHaveLength(1);
      expect(moves[0].notes).toBe(`animal-feed:group:${groupId}`);
    });
  });

  it('converts pounds to bags through lbPerBag, and asks for it when missing', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const bagged = feedItem({ unit: 'bag', lbPerBag: 50 });
      const res = await use(bagged.id, { lb: 25 });
      expect(res.status).toBe(201);
      expect(res.body.used).toEqual({ lb: 25, amount: 0.5, unit: 'bag' });
      const bare = feedItem({ unit: 'bag' });
      const missing = await use(bare.id, { lb: 25 });
      expect(missing.status).toBe(409);
      expect(missing.body.code).toBe('NEEDS_LB_PER_BAG');
    });
  });

  it('refuses stock that is not feed or bedding, inspectors, and another farm’s item', async () => {
    const other = seedOwner();
    let foreignId = '';
    await runWithTenantAsync(other, async () => {
      foreignId = feedItem().id;
    });
    await runWithTenantAsync(seedOwner(), async () => {
      const seed = feedItem({ category: 'seed', unit: 'lb' });
      const notFeed = await use(seed.id, { lb: 1 });
      expect(notFeed.status).toBe(400);
      expect(notFeed.body.code).toBe('NOT_FEED');

      const foreign = await use(foreignId, { lb: 1 });
      expect(foreign.status).toBe(404);

      m.role = 'inspector';
      await expect(use(feedItem().id, { lb: 1 })).rejects.toMatchObject({ status: 403 });
    });
    await runWithTenantAsync(other, async () => {
      expect(getStockItemWithBalance(foreignId)?.onHand).toBe(100);
    });
  });
});
