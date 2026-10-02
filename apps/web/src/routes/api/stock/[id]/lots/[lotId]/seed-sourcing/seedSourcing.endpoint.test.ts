// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/auth')>()),
  ...(await import('$lib/server/documents.testkit')).authOverrides()
}));

import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { stockLots } from '$lib/db/schema';
import { runWithTenant, withTenant } from '$lib/db/tenant';
import { createPlanned } from '$lib/db/crops';
import { createStockItem, receiveLot } from '$lib/db/stock';
import { createSeedStart } from '$lib/db/seedStarts';
import { documentStorageKey, insertDocument, insertDocumentLink } from '$lib/db/documents';
import { closeSeason } from '$lib/server/seasonClose';
import { actAs, call, seedFarm, type TestFarm } from '$lib/server/documents.testkit';
import { listSeedSourcing, seedSourcingForLots } from '$lib/stock/seedSourcing.server';
import { PATCH } from './+server';

const DAY = 86_400_000;
let farm: TestFarm;

const inFarm = <T>(f: TestFarm, fn: () => T): T => runWithTenant(f.ownerId, fn);

function seedLot(f: TestFarm, opts: { category?: 'seed' | 'fertilizer'; name?: string } = {}) {
  return inFarm(f, () => {
    const item = createStockItem({
      category: opts.category ?? 'seed',
      displayName: opts.name ?? 'Roma seed',
      defaultUnit: 'packet' as never
    });
    const lot = receiveLot({
      stockItemId: item.id,
      receivedQuantity: 2,
      unit: 'packet' as never,
      lotNumber: 'L-42'
    });
    return { itemId: item.id, lotId: lot.id };
  });
}

function patch(itemId: string, lotId: string, json: unknown) {
  return call(PATCH, {
    method: 'PATCH',
    path: `/api/stock/${itemId}/lots/${lotId}/seed-sourcing`,
    params: { id: itemId, lotId },
    json
  });
}

const VALID = {
  status: 'untreated',
  sourcesChecked: [
    {
      supplier: '  Johnny Seeds ',
      checkedAt: '2026-01-15',
      result: 'No organic seed of this variety'
    }
  ],
  unavailabilityNote: 'Only conventional untreated seed was offered.'
};

beforeEach(() => {
  farm = seedFarm();
  actAs(farm, 'owner');
});

describe('PATCH /api/stock/:id/lots/:lotId/seed-sourcing (B-37, B-38)', () => {
  it('saves all three fields for the owner and trims text', async () => {
    const { itemId, lotId } = seedLot(farm);
    const res = await patch(itemId, lotId, VALID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sourcing: { status: string; sourcesChecked: unknown[] } };
    expect(body.sourcing.status).toBe('untreated');
    const stored = inFarm(farm, () => seedSourcingForLots([lotId]).get(lotId)!);
    expect(stored.sourcesChecked).toEqual([
      {
        supplier: 'Johnny Seeds',
        checkedAt: '2026-01-15',
        result: 'No organic seed of this variety'
      }
    ]);
    expect(stored.unavailabilityNote).toBe('Only conventional untreated seed was offered.');
  });

  it('replaces the fields, and clears them with nulls and an empty list', async () => {
    const { itemId, lotId } = seedLot(farm);
    await patch(itemId, lotId, VALID);
    const res = await patch(itemId, lotId, {
      status: null,
      sourcesChecked: [],
      unavailabilityNote: '   '
    });
    expect(res.status).toBe(200);
    const row = inFarm(farm, () =>
      db
        .select()
        .from(stockLots)
        .where(withTenant(stockLots, eq(stockLots.id, lotId)))
        .get()
    )!;
    expect(row.seedOrganicStatus).toBeNull();
    expect(row.seedSourcesCheckedJson).toBeNull();
    expect(row.seedUnavailabilityNote).toBeNull();
  });

  it('is owner only, and refused while impersonating', async () => {
    const { itemId, lotId } = seedLot(farm);
    for (const role of ['helper', 'inspector'] as const) {
      actAs(farm, role);
      expect((await patch(itemId, lotId, VALID)).status).toBe(403);
    }
    actAs(farm, 'owner', { impersonating: true });
    const imp = await patch(itemId, lotId, VALID);
    expect(imp.status).toBe(403);
    expect(((await imp.json()) as { error: string }).error).toBe('NOT_WHILE_IMPERSONATING');
    actAs(farm, 'owner', { authVia: 'bearer' });
    expect((await patch(itemId, lotId, VALID)).status).toBe(200);
  });

  it('answers NOT_SEED for a lot of another category', async () => {
    const { itemId, lotId } = seedLot(farm, { category: 'fertilizer', name: 'Compost' });
    const res = await patch(itemId, lotId, VALID);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('NOT_SEED');
  });

  it('answers 404 for a lot of another item or another farm', async () => {
    const a = seedLot(farm);
    const b = seedLot(farm, { name: 'Basil seed' });
    expect((await patch(a.itemId, b.lotId, VALID)).status).toBe(404);
    const other = seedFarm();
    const theirs = seedLot(other);
    expect((await patch(theirs.itemId, theirs.lotId, VALID)).status).toBe(404);
    const untouched = inFarm(other, () => seedSourcingForLots([theirs.lotId]).get(theirs.lotId)!);
    expect(untouched.status).toBeNull();
  });

  it('validates the body (B-37)', async () => {
    const { itemId, lotId } = seedLot(farm);
    const bad: unknown[] = [
      { ...VALID, status: 'conventional' },
      { ...VALID, sourcesChecked: [{ supplier: '', checkedAt: '2026-01-01', result: 'x' }] },
      { ...VALID, sourcesChecked: [{ supplier: 'A', checkedAt: '2026-02-30', result: 'x' }] },
      {
        ...VALID,
        sourcesChecked: [{ supplier: 'A'.repeat(121), checkedAt: '2026-01-01', result: 'x' }]
      },
      {
        ...VALID,
        sourcesChecked: [{ supplier: 'A', checkedAt: '2026-01-01', result: 'r'.repeat(201) }]
      },
      {
        ...VALID,
        sourcesChecked: Array.from({ length: 31 }, () => ({
          supplier: 'A',
          checkedAt: '2026-01-01',
          result: 'Out of stock'
        }))
      },
      { ...VALID, extra: true },
      { status: 'organic' }
    ];
    for (const body of bad) expect((await patch(itemId, lotId, body)).status).toBe(400);
    const thirty = {
      ...VALID,
      sourcesChecked: Array.from({ length: 30 }, () => ({
        supplier: 'A',
        checkedAt: '2026-01-01',
        result: 'Out of stock'
      }))
    };
    expect((await patch(itemId, lotId, thirty)).status).toBe(200);
  });

  it('refuses a supplier check dated after the farm today', async () => {
    const { itemId, lotId } = seedLot(farm);
    const tomorrow = new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10);
    const res = await patch(itemId, lotId, {
      ...VALID,
      sourcesChecked: [{ supplier: 'A', checkedAt: tomorrow, result: 'Out of stock' }]
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { issues: { path: string }[] }).issues[0].path).toBe(
      'sourcesChecked.0.checkedAt'
    );
  });

  it('is never gated by the season close-out', async () => {
    const { itemId, lotId } = seedLot(farm);
    inFarm(farm, () =>
      closeSeason({
        year: new Date().getFullYear(),
        closedById: farm.ownerUser,
        plantingResolutions: [],
        harvestRollup: {},
        pendingCount: 0
      })
    );
    expect((await patch(itemId, lotId, VALID)).status).toBe(200);
  });
});

describe('listSeedSourcing (B-40)', () => {
  it('lists lots received in the window and lots planted from in the window', async () => {
    const now = Date.now();
    const recent = seedLot(farm, { name: 'Basil seed' });
    const old = seedLot(farm, { name: 'Old bean seed' });
    const oldUnused = seedLot(farm, { name: 'Unused squash seed' });
    const notSeed = seedLot(farm, { category: 'fertilizer', name: 'Compost' });
    inFarm(farm, () => {
      for (const id of [old.lotId, oldUnused.lotId, notSeed.lotId]) {
        db.update(stockLots)
          .set({ receivedAt: new Date(now - 800 * DAY) })
          .where(withTenant(stockLots, eq(stockLots.id, id)))
          .run();
      }
      const crop = createPlanned({
        blockId: farm.blockId,
        cropPluginId: 'crop:tomato',
        varietyDisplayName: 'Roma'
      });
      createSeedStart({
        cropId: crop.id,
        sownAt: now - 3 * DAY,
        performedById: null,
        stockLotId: old.lotId
      });
    });
    await patch(old.itemId, old.lotId, { ...VALID, status: 'treated', sourcesChecked: [] });
    const rows = inFarm(farm, () =>
      listSeedSourcing({ fromMs: now - 365 * DAY, toMs: Date.now() })
    );
    expect(rows.map((r) => r.itemName)).toEqual(['Basil seed', 'Old bean seed']);
    const oldRow = rows.find((r) => r.stockLotId === old.lotId)!;
    expect(oldRow.status).toBe('treated');
    expect(oldRow.lotNumber).toBe('L-42');
    expect(rows.find((r) => r.stockLotId === recent.lotId)!.status).toBeNull();
  });

  it('carries live search evidence ids and never another farm lots', async () => {
    const mine = seedLot(farm);
    const other = seedFarm();
    const theirs = seedLot(other);
    const docId = inFarm(farm, () => {
      const id = crypto.randomUUID();
      insertDocument({
        id,
        kind: 'seed-search',
        title: 'Supplier emails',
        mime: 'application/pdf',
        byteSize: 10,
        sha256: 'a'.repeat(64),
        crc32: 1,
        storageKey: documentStorageKey(farm.ownerId, id),
        originalName: 'emails.pdf',
        uploadedBy: farm.ownerUser
      });
      insertDocumentLink({
        documentId: id,
        subjectType: 'stock-lot',
        subjectId: mine.lotId,
        createdBy: farm.ownerUser
      });
      return id;
    });
    const now = Date.now();
    const rows = inFarm(farm, () => listSeedSourcing({ fromMs: now - DAY, toMs: now + DAY }));
    expect(rows.map((r) => r.stockLotId)).toEqual([mine.lotId]);
    expect(rows[0].documentIds).toEqual([docId]);
    expect(rows.some((r) => r.stockLotId === theirs.lotId)).toBe(false);
    const detail = inFarm(farm, () => seedSourcingForLots([mine.lotId, theirs.lotId]));
    expect([...detail.keys()]).toEqual([mine.lotId]);
    expect(detail.get(mine.lotId)!.documents.map((d) => d.title)).toEqual(['Supplier emails']);
  });
});
