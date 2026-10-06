// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import {
  harvestDispositions,
  harvestEvents,
  organicStatusEvents,
  owners,
  recordDeletions,
  users
} from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, tenantValues, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { insertCropHarvestEvent } from '$lib/db/harvestEvents';
import { insertLedgerEntry, softDeleteLedgerEntry } from '$lib/db/ledger';
import { deleteBlockCascade, deleteHarvestDisposition } from '$lib/db/admin';
import { getHarvestDisposition } from '$lib/db/harvestDispositions';
import { closeSeason } from '$lib/server/seasonClose';
import { projectActiveFarm } from '$lib/server/holdGuard';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { buildRecordCards } from '$lib/server/recordCards';
import { DEFAULT_PREFS } from '$lib/prefs';
import { GET as LIST, POST as CREATE } from './[id]/dispositions/+server';
import { DELETE as REMOVE, PATCH as EDIT } from './dispositions/[id]/+server';
import { DELETE as REMOVE_HARVEST } from './records/[id]/+server';
import { POST as LEDGER_CREATE } from '../finance/entries/+server';

type Handler = (event: never) => Response | Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const DAY = 86_400_000;
const HOUR = 3_600_000;

for (const id of ['disp-owner', 'disp-helper', 'disp-inspector']) {
  db.insert(users)
    .values({ id, email: `${id}@test.local` })
    .onConflictDoNothing()
    .run();
}

interface Viewer {
  ownerId: string;
  role?: 'owner' | 'helper' | 'inspector';
  impersonating?: boolean;
}

async function call(
  handler: unknown,
  viewer: Viewer,
  path: string,
  method: string,
  opts: { params?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: Json }> {
  const role = viewer.role ?? 'owner';
  const url = new URL(`http://localhost${path}`);
  return runWithTenantAsync(viewer.ownerId, async () => {
    try {
      const res = await (handler as Handler)({
        params: opts.params ?? {},
        url,
        request: new Request(url.href, {
          method,
          headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
        }),
        locals: {
          authVia: 'cookie',
          user: {
            id: `disp-${role}`,
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
      return { status: res.status, body: text ? JSON.parse(text) : {} };
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (!status) throw e;
      return { status, body: e };
    }
  });
}

interface Farm {
  ownerId: string;
  fieldId: string;
  blockId: string;
  cropId: string;
  harvestId: string;
  harvestAt: number;
}

function seedFarm(label: string, harvestAt = Date.now() - HOUR): Farm {
  const ownerId = `disp-${label}-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  return runWithTenant(ownerId, () => {
    const field = createField({ name: `${label} garden`, kind: 'garden' });
    const block = createBlock({ name: `${label} bed`, fieldId: field.id, acres: 0.01 });
    const crop = createPlanned({
      blockId: block.id,
      cropPluginId: 'tomato-amish-paste',
      varietyDisplayName: 'Amish Paste'
    });
    const harvest = insertCropHarvestEvent({
      blockId: block.id,
      cropId: crop.id,
      cropPluginId: 'tomato-amish-paste',
      occurredAt: harvestAt,
      quantity: '40 lb'
    });
    return {
      ownerId,
      fieldId: field.id,
      blockId: block.id,
      cropId: crop.id,
      harvestId: harvest.id,
      harvestAt
    };
  });
}

function add(
  farm: Farm,
  body: Record<string, unknown>,
  viewer: Partial<Viewer> = {},
  headers = {}
) {
  return call(
    CREATE,
    { ownerId: farm.ownerId, ...viewer },
    `/api/harvest/${farm.harvestId}/dispositions`,
    'POST',
    { params: { id: farm.harvestId }, body, headers }
  );
}

function edit(farm: Farm, id: string, body: unknown, viewer: Partial<Viewer> = {}) {
  return call(
    EDIT,
    { ownerId: farm.ownerId, ...viewer },
    `/api/harvest/dispositions/${id}`,
    'PATCH',
    {
      params: { id },
      body
    }
  );
}

function remove(farm: Farm, id: string, query = '', viewer: Partial<Viewer> = {}) {
  return call(
    REMOVE,
    { ownerId: farm.ownerId, ...viewer },
    `/api/harvest/dispositions/${id}${query}`,
    'DELETE',
    { params: { id } }
  );
}

function status(farm: Farm, subjectType: 'field' | 'block', subjectId: string, s: string) {
  runWithTenant(farm.ownerId, () =>
    db
      .insert(organicStatusEvents)
      .values(
        tenantValues({
          id: randomUUID(),
          subjectType,
          subjectId,
          status: s as 'organic',
          effectiveAt: new Date(farm.harvestAt - 30 * DAY),
          certifier: 'Example Certifier'
        })
      )
      .run()
  );
}

function backdate(farm: Farm, id: string, occurredAt: number) {
  runWithTenant(farm.ownerId, () =>
    db
      .update(harvestDispositions)
      .set({ occurredAt: new Date(occurredAt), lockedAt: null })
      .where(withTenant(harvestDispositions, eq(harvestDispositions.id, id)))
      .run()
  );
}

function tombstones(farm: Farm) {
  return runWithTenant(farm.ownerId, () =>
    db
      .select()
      .from(recordDeletions)
      .where(withTenant(recordDeletions, eq(recordDeletions.recordKind, 'harvest-disposition')))
      .all()
  );
}

describe('POST /api/harvest/:id/dispositions', () => {
  it('saves a helper disposition and an owner one; inspectors are read-only', async () => {
    const farm = seedFarm('basic');
    const h = await add(farm, { kind: 'kept', quantity: 5, unit: 'lb' }, { role: 'helper' });
    expect(h.status).toBe(201);
    expect(h.body.disposition).toMatchObject({ kind: 'kept', quantity: 5, unit: 'lb' });
    expect(h.body.organicNotice).toBeNull();
    const o = await add(farm, { kind: 'sold', quantity: 10.005, unit: 'lb', recipient: 'Market' });
    expect(o.status).toBe(201);
    expect(o.body.disposition.quantity).toBe(10.01);
    expect(o.body.disposition.recipient).toBe('Market');
    const i = await add(farm, { kind: 'kept', quantity: 1, unit: 'lb' }, { role: 'inspector' });
    expect(i.status).toBe(403);
    const list = await call(
      LIST,
      { ownerId: farm.ownerId, role: 'inspector' },
      `/api/harvest/${farm.harvestId}/dispositions`,
      'GET',
      { params: { id: farm.harvestId } }
    );
    expect(list.status).toBe(200);
    expect(list.body.dispositions).toHaveLength(2);
  });

  it('refuses fields that do not belong to the kind', async () => {
    const farm = seedFarm('fields');
    const r1 = await add(farm, { kind: 'kept', quantity: 1, unit: 'lb', recipient: 'Neighbour' });
    expect(r1.status).toBe(400);
    const r2 = await add(farm, { kind: 'donated', quantity: 1, unit: 'lb', soldAsOrganic: true });
    expect(r2.status).toBe(400);
    const r3 = await add(farm, { kind: 'sold', quantity: 0, unit: 'lb' });
    expect(r3.status).toBe(400);
    const r4 = await add(farm, { kind: 'sold', quantity: 1, unit: '   ' });
    expect(r4.status).toBe(400);
    const r5 = await add(farm, { kind: 'sold', quantity: 1, unit: 'lb', extra: 1 });
    expect(r5.status).toBe(400);
  });

  it('bounds the date to the harvest day and now (B-28)', async () => {
    const farm = seedFarm('dates', Date.now() - 3 * DAY);
    const before = await add(farm, {
      kind: 'kept',
      quantity: 1,
      unit: 'lb',
      occurredAt: farm.harvestAt - 2 * DAY
    });
    expect(before.status).toBe(400);
    expect(before.body.error).toBe('BEFORE_HARVEST');
    const future = await add(farm, {
      kind: 'kept',
      quantity: 1,
      unit: 'lb',
      occurredAt: Date.now() + HOUR
    });
    expect(future.body.error).toBe('IN_THE_FUTURE');
    const slack = await add(farm, {
      kind: 'kept',
      quantity: 1,
      unit: 'lb',
      occurredAt: Date.now() + 60_000
    });
    expect(slack.status).toBe(201);
  });

  it('is gated by the season close-out', async () => {
    const farm = seedFarm('closed', Date.UTC(2019, 5, 1, 15));
    runWithTenant(farm.ownerId, () =>
      closeSeason({ year: 2019, plantingResolutions: [], harvestRollup: {}, pendingCount: 0 })
    );
    const r = await add(farm, {
      kind: 'kept',
      quantity: 1,
      unit: 'lb',
      occurredAt: Date.UTC(2019, 5, 2, 15)
    });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('SEASON_CLOSED');
  });

  it('answers 404 for a harvest of another farm', async () => {
    const a = seedFarm('tenant-a');
    const b = seedFarm('tenant-b');
    const r = await call(
      CREATE,
      { ownerId: b.ownerId },
      `/api/harvest/${a.harvestId}/dispositions`,
      'POST',
      { params: { id: a.harvestId }, body: { kind: 'kept', quantity: 1, unit: 'lb' } }
    );
    expect(r.status).toBe(404);
    const g = await call(
      LIST,
      { ownerId: b.ownerId },
      `/api/harvest/${a.harvestId}/dispositions`,
      'GET',
      { params: { id: a.harvestId } }
    );
    expect(g.status).toBe(404);
  });

  it('replays once with the same client record id', async () => {
    const farm = seedFarm('replay');
    const headers = { [CLIENT_RECORD_HEADER]: `replay-${randomUUID()}` };
    const body = { kind: 'donated', quantity: 3, unit: 'dozen', occurredAt: Date.now() };
    const first = await add(farm, body, { role: 'helper' }, headers);
    expect(first.status).toBe(201);
    const second = await add(farm, body, { role: 'helper' }, headers);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    const rows = runWithTenant(farm.ownerId, () =>
      db.select().from(harvestDispositions).where(withTenant(harvestDispositions)).all()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].clientRecordId).toBe(headers[CLIENT_RECORD_HEADER]);
  });

  it('notes when the dispositions add up to more than the harvest (B-33)', async () => {
    const farm = seedFarm('over');
    const a = await add(farm, { kind: 'sold', quantity: 30, unit: 'LB' });
    expect(a.body.quantityNotice).toBeNull();
    const b = await add(farm, { kind: 'kept', quantity: 15, unit: 'lb' });
    expect(b.status).toBe(201);
    expect(b.body.quantityNotice).toBe("Where it went adds up to more than this harvest's 40 lb.");
    const c = await add(farm, { kind: 'kept', quantity: 500, unit: 'each' });
    expect(c.body.quantityNotice).toBeNull();
  });
});

describe('sold as organic (B-27, B-32)', () => {
  it('stores null while the farm has no organic status', async () => {
    const farm = seedFarm('no-organic');
    const r = await add(farm, { kind: 'sold', quantity: 1, unit: 'lb', soldAsOrganic: true });
    expect(r.status).toBe(201);
    expect(r.body.disposition.soldAsOrganic).toBeNull();
    expect(r.body.organicNotice).toBeNull();
  });

  it('saves with a notice when the block was not organic at harvest', async () => {
    const farm = seedFarm('transitioning');
    status(farm, 'block', farm.blockId, 'transitioning');
    const r = await add(farm, { kind: 'sold', quantity: 1, unit: 'lb', soldAsOrganic: true });
    expect(r.status).toBe(201);
    expect(r.body.disposition.soldAsOrganic).toBe(true);
    expect(r.body.organicNotice).toMatch(
      /^This block was transitioning \(owner-entered, effective .+, certifier Example Certifier\) on .+\.$/
    );
    const no = await add(farm, { kind: 'sold', quantity: 1, unit: 'lb', soldAsOrganic: false });
    expect(no.body.organicNotice).toBeNull();
  });

  it('gives no notice when the block inherits organic from its Area', async () => {
    const farm = seedFarm('organic-area');
    status(farm, 'field', farm.fieldId, 'organic');
    const r = await add(farm, { kind: 'sold', quantity: 1, unit: 'lb', soldAsOrganic: true });
    expect(r.body.organicNotice).toBeNull();
  });

  it('says so when a farm with statuses has none on this block', async () => {
    const farm = seedFarm('other-block');
    status(farm, 'block', `not-${farm.blockId}`, 'organic');
    const r = await add(farm, { kind: 'sold', quantity: 1, unit: 'lb', soldAsOrganic: true });
    expect(r.body.organicNotice).toMatch(/^This block had no organic status on file on .+\.$/);
  });
});

describe('PATCH and DELETE /api/harvest/dispositions/:id (B-29)', () => {
  it('lets a helper change and delete inside the lock, with no tombstone', async () => {
    const farm = seedFarm('unlocked');
    const r = await add(farm, { kind: 'sold', quantity: 4, unit: 'lb', recipient: 'Ann' });
    const id = r.body.disposition.id;
    const p = await edit(farm, id, { kind: 'kept' }, { role: 'helper' });
    expect(p.status).toBe(200);
    expect(p.body.disposition).toMatchObject({ kind: 'kept', recipient: null });
    const bad = await edit(farm, id, { recipient: 'Bob' }, { role: 'helper' });
    expect(bad.status).toBe(400);
    const insp = await edit(farm, id, { quantity: 2 }, { role: 'inspector' });
    expect(insp.status).toBe(403);
    const d = await remove(farm, id, '', { role: 'helper' });
    expect(d.status).toBe(200);
    expect(d.body.tombstone).toBe(false);
    expect(tombstones(farm)).toHaveLength(0);
  });

  it('refuses edits after the lock and needs the owner, force and a reason to delete', async () => {
    const farm = seedFarm('locked', Date.now() - 5 * DAY);
    const r = await add(farm, { kind: 'kept', quantity: 4, unit: 'lb' });
    const id = r.body.disposition.id;
    backdate(farm, id, Date.now() - 3 * DAY);
    const p = await edit(farm, id, { quantity: 3 });
    expect(p.status).toBe(409);
    expect(p.body.error).toBe('RECORD_LOCKED');
    const plain = await remove(farm, id);
    expect(plain.status).toBe(409);
    const helper = await remove(farm, id, '?force=true&reason=typo', { role: 'helper' });
    expect(helper.status).toBe(403);
    const noReason = await remove(farm, id, '?force=true');
    expect(noReason.status).toBe(400);
    const ok = await remove(farm, id, '?force=true&reason=Entered%20twice');
    expect(ok.status).toBe(200);
    expect(ok.body.tombstone).toBe(true);
    const tomb = tombstones(farm);
    expect(tomb).toHaveLength(1);
    expect(tomb[0].reason).toBe('Entered twice');
    expect(JSON.parse(tomb[0].snapshotJson)).toMatchObject({ id, kind: 'kept', quantity: 4 });
  });

  it('re-dating a disposition never pushes its lock past 48 h after the save', async () => {
    const farm = seedFarm('redate', Date.now() - 3 * DAY);
    const r = await add(farm, { kind: 'sold', quantity: 4, unit: 'lb', recipient: 'Ann' });
    const id = r.body.disposition.id;
    runWithTenant(farm.ownerId, () =>
      db
        .update(harvestDispositions)
        .set({
          createdAt: new Date(Date.now() - 47 * HOUR),
          occurredAt: new Date(Date.now() - 47 * HOUR)
        })
        .where(withTenant(harvestDispositions, eq(harvestDispositions.id, id)))
        .run()
    );
    const moved = await edit(farm, id, { occurredAt: Date.now() }, { role: 'helper' });
    expect(moved.status).toBe(200);
    runWithTenant(farm.ownerId, () =>
      db
        .update(harvestDispositions)
        .set({ createdAt: new Date(Date.now() - 49 * HOUR) })
        .where(withTenant(harvestDispositions, eq(harvestDispositions.id, id)))
        .run()
    );
    const again = await edit(farm, id, { occurredAt: Date.now() }, { role: 'helper' });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('RECORD_LOCKED');
  });

  it('links the ledger for the owner only, even after the lock (B-31)', async () => {
    const farm = seedFarm('ledger', Date.now() - 5 * DAY);
    const r = await add(farm, { kind: 'sold', quantity: 4, unit: 'lb' });
    const id = r.body.disposition.id;
    backdate(farm, id, Date.now() - 3 * DAY);
    const entry = runWithTenant(farm.ownerId, () =>
      insertLedgerEntry(
        {
          kind: 'income',
          occurredAt: Date.now(),
          amountCents: 800,
          category: 'produce-sale',
          harvestEventId: farm.harvestId
        },
        'disp-owner'
      )
    );
    const helper = await edit(farm, id, { ledgerEntryId: entry.id }, { role: 'helper' });
    expect(helper.status).toBe(403);
    const imp = await edit(farm, id, { ledgerEntryId: entry.id }, { impersonating: true });
    expect(imp.status).toBe(403);
    const other = seedFarm('ledger-other');
    const foreign = runWithTenant(other.ownerId, () =>
      insertLedgerEntry(
        { kind: 'income', occurredAt: Date.now(), amountCents: 1, category: 'produce-sale' },
        'disp-owner'
      )
    );
    const cross = await edit(farm, id, { ledgerEntryId: foreign.id });
    expect(cross.status).toBe(400);
    const ok = await edit(farm, id, { ledgerEntryId: entry.id });
    expect(ok.status).toBe(200);
    expect(ok.body.disposition).toMatchObject({ ledgerEntryId: entry.id, sale: 'live' });

    const asHelper = await call(
      LIST,
      { ownerId: farm.ownerId, role: 'helper' },
      `/api/harvest/${farm.harvestId}/dispositions`,
      'GET',
      { params: { id: farm.harvestId } }
    );
    expect(asHelper.body.dispositions[0]).toMatchObject({ ledgerEntryId: null, sale: null });

    runWithTenant(farm.ownerId, () => softDeleteLedgerEntry(entry.id, 'disp-owner'));
    const after = await call(
      LIST,
      { ownerId: farm.ownerId },
      `/api/harvest/${farm.harvestId}/dispositions`,
      'GET',
      { params: { id: farm.harvestId } }
    );
    expect(after.body.dispositions[0].sale).toBe('deleted');
    const cleared = await edit(farm, id, { ledgerEntryId: null });
    expect(cleared.body.disposition.ledgerEntryId).toBeNull();
  });

  it('answers 404 for another farm', async () => {
    const a = seedFarm('x-a');
    const b = seedFarm('x-b');
    const r = await add(a, { kind: 'kept', quantity: 1, unit: 'lb' });
    const id = r.body.disposition.id;
    expect((await edit(b, id, { quantity: 2 })).status).toBe(404);
    expect((await remove(b, id)).status).toBe(404);
    expect(runWithTenant(a.ownerId, () => getHarvestDisposition(id))).toBeDefined();
  });
});

describe('harvest deletes and cascades (B-30)', () => {
  it('refuses to delete a harvest that has dispositions', async () => {
    const farm = seedFarm('harvest-del');
    const r = await add(farm, { kind: 'kept', quantity: 1, unit: 'lb' });
    const blocked = await call(
      REMOVE_HARVEST,
      { ownerId: farm.ownerId },
      `/api/harvest/records/${farm.harvestId}`,
      'DELETE',
      { params: { id: farm.harvestId } }
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('HARVEST_HAS_DISPOSITIONS');
    await remove(farm, r.body.disposition.id);
    const ok = await call(
      REMOVE_HARVEST,
      { ownerId: farm.ownerId },
      `/api/harvest/records/${farm.harvestId}`,
      'DELETE',
      { params: { id: farm.harvestId } }
    );
    expect(ok.status).toBe(200);
  });

  it('a block delete (through its planting) removes dispositions first and tombstones the locked ones', async () => {
    const farm = seedFarm('block-del', Date.now() - 5 * DAY);
    const locked = await add(farm, { kind: 'kept', quantity: 1, unit: 'lb' });
    backdate(farm, locked.body.disposition.id, Date.now() - 3 * DAY);
    await add(farm, { kind: 'sold', quantity: 2, unit: 'lb' });
    runWithTenant(farm.ownerId, () => db.transaction(() => deleteBlockCascade(farm.blockId)));
    const left = runWithTenant(farm.ownerId, () =>
      db.select().from(harvestDispositions).where(withTenant(harvestDispositions)).all()
    );
    expect(left).toHaveLength(0);
    const harvests = runWithTenant(farm.ownerId, () =>
      db
        .select()
        .from(harvestEvents)
        .where(withTenant(harvestEvents, and(eq(harvestEvents.id, farm.harvestId))))
        .all()
    );
    expect(harvests).toHaveLength(0);
    const tomb = tombstones(farm);
    expect(tomb).toHaveLength(1);
    expect(tomb[0].recordId).toBe(locked.body.disposition.id);
    expect(tomb[0].reason).toBe('planting deleted');
  });
});

describe('holds (O-13, B-35)', () => {
  it('a disposition tombstone leaves the hold projection unchanged', async () => {
    const farm = seedFarm('holds', Date.now() - 5 * DAY);
    const r = await add(farm, { kind: 'discarded', quantity: 1, unit: 'lb' });
    backdate(farm, r.body.disposition.id, Date.now() - 3 * DAY);
    const now = Date.now();
    const before = await runWithTenantAsync(farm.ownerId, () =>
      projectActiveFarm('America/New_York', now)
    );
    runWithTenant(farm.ownerId, () =>
      deleteHarvestDisposition(r.body.disposition.id, { force: true, reason: 'test' })
    );
    const after = await runWithTenantAsync(farm.ownerId, () =>
      projectActiveFarm('America/New_York', now)
    );
    expect(tombstones(farm)).toHaveLength(1);
    expect(after.loaded.facts).toEqual(before.loaded.facts);
    expect(JSON.stringify(after.projection)).toBe(JSON.stringify(before.projection));
  });
});

describe('"Also record the money" (B-31)', () => {
  it('links a new sale to its disposition once, only for the same harvest', async () => {
    const farm = seedFarm('sale-link');
    const r = await add(farm, { kind: 'sold', quantity: 10, unit: 'lb' });
    const id = r.body.disposition.id;
    const sale = (dispositionId: string, harvestEventId = farm.harvestId) =>
      call(LEDGER_CREATE, { ownerId: farm.ownerId }, '/api/finance/entries', 'POST', {
        body: {
          kind: 'income',
          occurredAt: Date.now(),
          amountCents: 2000,
          category: 'produce-sale',
          harvestEventId,
          dispositionId
        }
      });
    const first = await sale(id);
    expect(first.status).toBe(201);
    expect(first.body.dispositionLinked).toBe(true);
    const linked = runWithTenant(farm.ownerId, () => getHarvestDisposition(id));
    expect(linked?.ledgerEntryId).toBe(first.body.entry.id);
    const second = await sale(id);
    expect(second.status).toBe(201);
    expect(second.body.dispositionLinked).toBe(false);
    expect(runWithTenant(farm.ownerId, () => getHarvestDisposition(id))?.ledgerEntryId).toBe(
      first.body.entry.id
    );

    const otherHarvest = runWithTenant(farm.ownerId, () =>
      insertCropHarvestEvent({
        blockId: farm.blockId,
        cropPluginId: 'tomato-amish-paste',
        occurredAt: Date.now() - HOUR,
        quantity: '5 lb'
      })
    );
    const r2 = await add(farm, { kind: 'sold', quantity: 1, unit: 'lb' });
    const wrong = await sale(r2.body.disposition.id, otherHarvest.id);
    expect(wrong.body.dispositionLinked).toBe(false);

    const expense = await call(
      LEDGER_CREATE,
      { ownerId: farm.ownerId },
      '/api/finance/entries',
      'POST',
      {
        body: {
          kind: 'expense',
          occurredAt: Date.now(),
          amountCents: 100,
          category: 'supplies',
          dispositionId: r2.body.disposition.id
        }
      }
    );
    expect(expense.status).toBe(400);
  });
});

describe('harvest record card (B-36)', () => {
  it('lists where the harvest went, read-only and without money', async () => {
    const farm = seedFarm('card');
    await add(farm, { kind: 'sold', quantity: 4, unit: 'lb', recipient: 'Market' });
    const out = await runWithTenantAsync(farm.ownerId, () =>
      buildRecordCards('harvest', farm.harvestId, { prefs: DEFAULT_PREFS, origin: null })
    );
    const section = out?.cards[0]?.sections.find((s) => s.title === 'Where it went');
    expect(section?.items).toHaveLength(1);
    expect(section?.items[0]).toMatch(/^Sold 4 lb to Market on /);
    expect(section?.provenance).toBe('manual');
  });
});
