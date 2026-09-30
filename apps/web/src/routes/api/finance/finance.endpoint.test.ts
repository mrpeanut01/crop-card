// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { ledgerEntryChanges, owners, taskTimeEntries, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, tenantValues, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { createStockItem, receiveLot, recordMovement } from '$lib/db/stock';
import { insertCropHarvestEvent } from '$lib/db/harvestEvents';
import { getSetting } from '$lib/db/settings';
import { GET as LIST, POST as CREATE } from './entries/+server';
import { DELETE as REMOVE, GET as ONE, PATCH as EDIT } from './entries/[id]/+server';
import { POST as RESTORE } from './entries/[id]/restore/+server';
import { GET as SUMMARY } from './summary/+server';
import { GET as CSV } from './export.csv/+server';
import { PUT as RATE } from './labour-rate/+server';

type Handler = (event: never) => Response | Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const DAY = 86_400_000;

for (const id of ['fin-owner', 'fin-helper', 'fin-inspector', 'fin-operator']) {
  db.insert(users)
    .values({ id, email: `${id}@test.local` })
    .onConflictDoNothing()
    .run();
}

interface Viewer {
  ownerId: string;
  role?: 'owner' | 'helper' | 'inspector' | 'custom-operator';
  impersonating?: boolean;
  bearer?: boolean;
}

async function call(
  handler: unknown,
  viewer: Viewer,
  path: string,
  method: string,
  opts: { params?: Record<string, string>; body?: unknown } = {}
): Promise<{ status: number; body: Json; text: string; headers: Headers }> {
  const role = viewer.role ?? 'owner';
  const url = new URL(`http://localhost/api/finance${path}`);
  return runWithTenantAsync(viewer.ownerId, async () => {
    try {
      const res = await (handler as Handler)({
        params: opts.params ?? {},
        url,
        request: new Request(url.href, {
          method,
          headers: { 'content-type': 'application/json' },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
        }),
        locals: {
          authVia: viewer.bearer ? 'bearer' : 'cookie',
          user: {
            id:
              role === 'owner'
                ? 'fin-owner'
                : `fin-${role === 'custom-operator' ? 'operator' : role}`,
            email: null,
            phone: null,
            role,
            activeOwnerId: viewer.ownerId,
            isSuperadmin: false,
            impersonating: viewer.impersonating ?? false
          }
        },
        cookies: { get: () => undefined }
      } as never);
      const text = await res.text();
      let body: Json = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = {};
      }
      return { status: res.status, body, text, headers: res.headers };
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (!status) throw e;
      return { status, body: e, text: '', headers: new Headers() };
    }
  });
}

interface Farm {
  ownerId: string;
  fieldId: string;
  otherFieldId: string;
  blockId: string;
  cropId: string;
  lotId: string;
  harvestId: string;
}

function seedFarm(label: string): Farm {
  const ownerId = `fin-${label}-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  return runWithTenant(ownerId, () => {
    const field = createField({ name: `${label} garden`, kind: 'garden' });
    const other = createField({ name: `${label} pasture`, kind: 'pasture' });
    const block = createBlock({ name: `${label} bed`, fieldId: field.id, acres: 0.01 });
    const crop = createPlanned({
      blockId: block.id,
      cropPluginId: 'tomato-amish-paste',
      varietyDisplayName: 'Amish Paste'
    });
    const item = createStockItem({
      category: 'seed',
      displayName: `${label} seed`,
      defaultUnit: 'seeds'
    });
    const lot = receiveLot({
      stockItemId: item.id,
      receivedQuantity: 100,
      unit: 'seeds',
      receivedCostCents: 2000
    });
    recordMovement({
      stockLotId: lot.id,
      delta: -10,
      unit: 'seeds',
      reason: 'planting',
      cropId: crop.id
    });
    const unpricedItem = createStockItem({
      category: 'fertilizer',
      displayName: `${label} compost`,
      defaultUnit: 'lb'
    });
    const unpriced = receiveLot({ stockItemId: unpricedItem.id, receivedQuantity: 50, unit: 'lb' });
    recordMovement({
      stockLotId: unpriced.id,
      delta: -5,
      unit: 'lb',
      reason: 'planting',
      cropId: crop.id
    });
    const harvest = insertCropHarvestEvent({
      blockId: block.id,
      cropId: crop.id,
      cropPluginId: 'tomato-amish-paste',
      occurredAt: Date.now() - DAY,
      quantity: '40 lb'
    });
    db.insert(taskTimeEntries)
      .values(
        tenantValues({ id: randomUUID(), cropId: crop.id, minutes: 90, startedAt: new Date() })
      )
      .run();
    return {
      ownerId,
      fieldId: field.id,
      otherFieldId: other.id,
      blockId: block.id,
      cropId: crop.id,
      lotId: lot.id,
      harvestId: harvest.id
    };
  });
}

const now = Date.now();
const expense = (extra: Record<string, unknown> = {}) => ({
  kind: 'expense',
  occurredAt: now - DAY,
  amountCents: 1250,
  category: 'supplies',
  description: 'Twine',
  ...extra
});

describe('/api/finance access (F2-1)', () => {
  const farm = seedFarm('access');

  it.each(['helper', 'inspector', 'custom-operator'] as const)(
    'refuses a %s every route',
    async (role) => {
      const v = { ownerId: farm.ownerId, role };
      const p = { id: 'x' };
      expect((await call(LIST, v, '/entries', 'GET')).status).toBe(403);
      expect((await call(CREATE, v, '/entries', 'POST', { body: expense() })).status).toBe(403);
      expect((await call(ONE, v, '/entries/x', 'GET', { params: p })).status).toBe(403);
      expect((await call(EDIT, v, '/entries/x', 'PATCH', { params: p, body: {} })).status).toBe(
        403
      );
      expect((await call(REMOVE, v, '/entries/x', 'DELETE', { params: p })).status).toBe(403);
      expect((await call(RESTORE, v, '/entries/x/restore', 'POST', { params: p })).status).toBe(
        403
      );
      expect((await call(SUMMARY, v, '/summary', 'GET')).status).toBe(403);
      expect((await call(CSV, v, '/export.csv', 'GET')).status).toBe(403);
      expect(
        (await call(RATE, v, '/labour-rate', 'PUT', { body: { centsPerHour: 1 } })).status
      ).toBe(403);
    }
  );

  it('lets impersonation read and never write', async () => {
    const v = { ownerId: farm.ownerId, impersonating: true };
    expect((await call(LIST, v, '/entries', 'GET')).status).toBe(200);
    expect((await call(SUMMARY, v, '/summary', 'GET')).status).toBe(200);
    expect((await call(CREATE, v, '/entries', 'POST', { body: expense() })).status).toBe(403);
    expect((await call(RATE, v, '/labour-rate', 'PUT', { body: { centsPerHour: 1 } })).status).toBe(
      403
    );
  });

  it('lets an owner Bearer token read and write', async () => {
    const v = { ownerId: farm.ownerId, bearer: true };
    const made = await call(CREATE, v, '/entries', 'POST', { body: expense() });
    expect(made.status).toBe(201);
    expect((await call(LIST, v, '/entries', 'GET')).body.entries.length).toBeGreaterThan(0);
  });
});

describe('/api/finance entries', () => {
  it('creates, edits, deletes and restores with an audit row for each', async () => {
    const farm = seedFarm('crud');
    const v = { ownerId: farm.ownerId };
    const made = await call(CREATE, v, '/entries', 'POST', {
      body: expense({ fieldId: farm.fieldId, blockId: farm.blockId })
    });
    expect(made.status).toBe(201);
    const id = made.body.entry.id;
    expect(made.body.entry.provenance).toBe('manual');

    const edited = await call(EDIT, v, `/entries/${id}`, 'PATCH', {
      params: { id },
      body: { amountCents: 2000, description: 'More twine' }
    });
    expect(edited.status).toBe(200);
    expect(edited.body.entry.amountCents).toBe(2000);
    expect(edited.body.entry.blockId).toBe(farm.blockId);

    expect((await call(REMOVE, v, `/entries/${id}`, 'DELETE', { params: { id } })).status).toBe(
      200
    );
    const live = await call(LIST, v, '/entries', 'GET');
    expect(live.body.entries.map((e: Json) => e.id)).not.toContain(id);
    const deleted = await call(LIST, v, '/entries?state=deleted', 'GET');
    expect(deleted.body.entries.map((e: Json) => e.id)).toEqual([id]);

    expect(
      (await call(RESTORE, v, `/entries/${id}/restore`, 'POST', { params: { id } })).status
    ).toBe(200);
    const one = await call(ONE, v, `/entries/${id}`, 'GET', { params: { id } });
    expect(one.body.changes.map((c: Json) => c.action)).toEqual([
      'create',
      'update',
      'delete',
      'restore'
    ]);
    expect(one.body.changes[1].before.amountCents).toBe(1250);
    expect(one.body.changes[1].after.amountCents).toBe(2000);
    expect(one.body.entry.linkedTo).toBe('Area: crud garden, crud bed');
  });

  it('checks the body: category per kind, one link, bed in its Area, dates, lot and harvest sides', async () => {
    const farm = seedFarm('rules');
    const v = { ownerId: farm.ownerId };
    const bad = async (body: unknown) =>
      (await call(CREATE, v, '/entries', 'POST', { body })).status;
    expect(await bad(expense({ category: 'produce-sale' }))).toBe(400);
    expect(await bad(expense({ cropId: farm.cropId, fieldId: farm.fieldId }))).toBe(400);
    expect(await bad(expense({ blockId: farm.blockId }))).toBe(400);
    expect(await bad(expense({ fieldId: farm.otherFieldId, blockId: farm.blockId }))).toBe(400);
    expect(await bad(expense({ occurredAt: Date.now() + 2 * DAY }))).toBe(400);
    expect(await bad(expense({ amountCents: 0 }))).toBe(400);
    expect(await bad(expense({ amountCents: 1_000_000_001 }))).toBe(400);
    expect(await bad(expense({ harvestEventId: farm.harvestId }))).toBe(400);
    expect(
      await bad({ ...expense(), kind: 'income', category: 'produce-sale', stockLotId: farm.lotId })
    ).toBe(400);
    expect(await bad(expense({ description: 'x'.repeat(201) }))).toBe(400);
    expect(await bad(expense({ enterprise: 'x'.repeat(61) }))).toBe(400);
    expect(await bad(expense({ occurredAt: Date.now() + DAY / 2 }))).toBe(201);
  });

  it("refuses another Owner's ids and never shows another Owner's entries", async () => {
    const a = seedFarm('ta');
    const b = seedFarm('tb');
    const va = { ownerId: a.ownerId };
    const vb = { ownerId: b.ownerId };
    for (const ref of [
      { cropId: b.cropId },
      { fieldId: b.fieldId },
      { stockLotId: b.lotId },
      { animalId: 'nope' },
      { animalGroupId: 'nope' }
    ]) {
      expect((await call(CREATE, va, '/entries', 'POST', { body: expense(ref) })).status).toBe(400);
    }
    expect(
      (
        await call(CREATE, va, '/entries', 'POST', {
          body: {
            kind: 'income',
            occurredAt: now,
            amountCents: 5,
            category: 'produce-sale',
            harvestEventId: b.harvestId
          }
        })
      ).status
    ).toBe(400);
    const mine = await call(CREATE, va, '/entries', 'POST', { body: expense() });
    const id = mine.body.entry.id;
    expect((await call(ONE, vb, `/entries/${id}`, 'GET', { params: { id } })).status).toBe(404);
    expect(
      (
        await call(EDIT, vb, `/entries/${id}`, 'PATCH', {
          params: { id },
          body: { amountCents: 9 }
        })
      ).status
    ).toBe(404);
    expect((await call(REMOVE, vb, `/entries/${id}`, 'DELETE', { params: { id } })).status).toBe(
      404
    );
    expect(
      (await call(RESTORE, vb, `/entries/${id}/restore`, 'POST', { params: { id } })).status
    ).toBe(404);
    const theirs = await call(LIST, vb, '/entries', 'GET');
    expect(JSON.stringify(theirs.body)).not.toContain(id);
    const audit = runWithTenant(b.ownerId, () =>
      db.select().from(ledgerEntryChanges).where(withTenant(ledgerEntryChanges)).all()
    );
    expect(audit.map((r) => r.entryId)).not.toContain(id);
  });

  it('allows one live purchase expense per lot (F2-11)', async () => {
    const farm = seedFarm('lot');
    const v = { ownerId: farm.ownerId };
    const first = await call(CREATE, v, '/entries', 'POST', {
      body: expense({ category: 'seed-and-plants', amountCents: 2000, stockLotId: farm.lotId })
    });
    expect(first.status).toBe(201);
    const again = await call(CREATE, v, '/entries', 'POST', {
      body: expense({ stockLotId: farm.lotId })
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('LOT_ALREADY_EXPENSED');

    const id = first.body.entry.id;
    await call(REMOVE, v, `/entries/${id}`, 'DELETE', { params: { id } });
    const second = await call(CREATE, v, '/entries', 'POST', {
      body: expense({ stockLotId: farm.lotId })
    });
    expect(second.status).toBe(201);
    const restore = await call(RESTORE, v, `/entries/${id}/restore`, 'POST', { params: { id } });
    expect(restore.status).toBe(409);
  });
});

describe('/api/finance summary, CSV and labour rate', () => {
  it('reconciles cash, derives input cost from stock use and never double counts the lot', async () => {
    const farm = seedFarm('sum');
    const v = { ownerId: farm.ownerId };
    await call(CREATE, v, '/entries', 'POST', {
      body: expense({ category: 'seed-and-plants', amountCents: 2000, stockLotId: farm.lotId })
    });
    await call(CREATE, v, '/entries', 'POST', {
      body: {
        kind: 'income',
        occurredAt: now - DAY,
        amountCents: 12000,
        category: 'produce-sale',
        cropId: farm.cropId,
        harvestEventId: farm.harvestId,
        quantity: 40,
        unit: 'lb'
      }
    });
    await call(RATE, v, '/labour-rate', 'PUT', { body: { centsPerHour: 1600 } });
    const res = await call(SUMMARY, v, '/summary', 'GET');
    expect(res.status).toBe(200);
    const p = res.body.profit;
    expect(p.cash).toEqual({ incomeCents: 12000, expenseCents: 2000, netCents: 10000 });
    expect(p.lotPurchaseCents).toBe(2000);
    const tomato = p.enterprises.find((e: Json) => e.kind === 'crop');
    expect(tomato.incomeCents).toBe(12000);
    expect(tomato.directExpenseCents).toBe(0);
    expect(tomato.inputCostCents).toBe(200);
    expect(tomato.inputCostUnknownCount).toBe(1);
    expect(tomato.labourMinutes).toBe(90);
    expect(tomato.labourCents).toBe(2400);
  });

  it('exports live entries as formula-safe CSV', async () => {
    const farm = seedFarm('csv');
    const v = { ownerId: farm.ownerId };
    await call(CREATE, v, '/entries', 'POST', {
      body: expense({ description: '=HYPERLINK("x")' })
    });
    const gone = await call(CREATE, v, '/entries', 'POST', {
      body: expense({ description: 'Deleted one' })
    });
    await call(REMOVE, v, '/x', 'DELETE', { params: { id: gone.body.entry.id } });
    const res = await call(CSV, v, '/export.csv', 'GET');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'date,kind,category,amount,description,linked to,enterprise,quantity,unit,entered by'
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[1]).toContain('fin-owner');
    expect(res.text).not.toContain('Deleted one');
  });

  it('stores and clears the labour rate', async () => {
    const farm = seedFarm('rate');
    const v = { ownerId: farm.ownerId };
    expect((await call(RATE, v, '/labour-rate', 'PUT', { body: { centsPerHour: 0 } })).status).toBe(
      400
    );
    expect(
      (await call(RATE, v, '/labour-rate', 'PUT', { body: { centsPerHour: 1850 } })).status
    ).toBe(200);
    expect(runWithTenant(farm.ownerId, () => getSetting('labour_rate_cents_per_hour'))).toBe(
      '1850'
    );
    await call(RATE, v, '/labour-rate', 'PUT', { body: { centsPerHour: null } });
    expect(
      runWithTenant(farm.ownerId, () => getSetting('labour_rate_cents_per_hour'))
    ).toBeUndefined();
  });
});
