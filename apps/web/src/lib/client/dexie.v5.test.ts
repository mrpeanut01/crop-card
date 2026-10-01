import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { db } from './dexie';
import { ENDPOINT_BY_KIND } from './syncQueue';

const V3_STORES = {
  pendingSprayRecords: 'id, ownerId, createdAt, [ownerId+createdAt]',
  cachedCatalogs: 'key, ownerId, [ownerId+catalogKind]'
};

const V4_STORES = {
  ...V3_STORES,
  farmSnapshots: 'ownerId',
  pinnedCards: '[ownerId+key], ownerId, [ownerId+pinnedAt]'
};

beforeEach(async () => {
  db().close();
  await Dexie.delete('cropcard');
});

function queueRow(id: string, ownerId: string, kind: string) {
  return { id, ownerId, kind, occurredAt: 1, payload: { x: 1 }, attempts: 0, createdAt: 1 };
}

describe('Dexie v5 upgrade', () => {
  it('keeps v3 queue and catalog rows and adds the Card tables', async () => {
    const v3 = new Dexie('cropcard');
    v3.version(3).stores(V3_STORES);
    await v3.table('pendingSprayRecords').put(queueRow('r1', 'owner_a', 'fungicide'));
    await v3.table('cachedCatalogs').put({
      key: 'owner_a:plugins',
      ownerId: 'owner_a',
      catalogKind: 'plugins',
      body: [],
      fetchedAt: 1
    });
    v3.close();

    const d = db();
    await d.open();
    expect(d.verno).toBe(6);
    expect(await d.pendingSprayRecords.get('r1')).toMatchObject({
      kind: 'fungicide',
      ownerId: 'owner_a'
    });
    expect(await d.cachedCatalogs.get('owner_a:plugins')).toBeDefined();
    expect(d.farmSnapshots.schema.primKey.keyPath).toBe('ownerId');
    expect(d.pinnedCards.schema.primKey.keyPath).toEqual(['ownerId', 'key']);
    expect(await d.farmSnapshots.count()).toBe(0);
    expect(await d.pinnedCards.count()).toBe(0);
  });

  it('keeps v4 rows, snapshots and pins, and indexes the queue by Owner and kind', async () => {
    const v4 = new Dexie('cropcard');
    v4.version(4).stores(V4_STORES);
    await v4
      .table('pendingSprayRecords')
      .bulkPut([
        queueRow('t1', 'owner_a', 'task'),
        queueRow('s1', 'owner_a', 'scout'),
        queueRow('t2', 'owner_b', 'task')
      ]);
    await v4.table('pinnedCards').put({ ownerId: 'owner_a', key: 'sp_1', pinnedAt: 5 });
    await v4
      .table('farmSnapshots')
      .put({ ownerId: 'owner_a', etag: 'W/"1"', fetchedAt: 2, bundle: {} });
    v4.close();

    const d = db();
    await d.open();
    expect(d.verno).toBe(6);
    expect(await d.pendingSprayRecords.count()).toBe(3);
    expect(await d.pinnedCards.get(['owner_a', 'sp_1'])).toMatchObject({ pinnedAt: 5 });
    expect(await d.farmSnapshots.get('owner_a')).toMatchObject({ etag: 'W/"1"' });
    const aTasks = await d.pendingSprayRecords
      .where('[ownerId+kind]')
      .equals(['owner_a', 'task'])
      .primaryKeys();
    expect(aTasks).toEqual(['t1']);
  });
});

describe('Phase 32 queue kinds', () => {
  it('routes every Phase 32 kind', () => {
    expect(ENDPOINT_BY_KIND['animal-move']).toBe('/api/animals/move');
    expect(ENDPOINT_BY_KIND['animal-health']).toBe('/api/animals/health/record');
    expect(ENDPOINT_BY_KIND['animal-production']).toBe('/api/animals/production/record');
    expect(ENDPOINT_BY_KIND['seed-start']).toBe('/api/seed-starts/:id/progress');
    expect(ENDPOINT_BY_KIND.irrigation).toBe('/api/irrigation');
    expect(ENDPOINT_BY_KIND['rain-gauge']).toBe('/api/rain-gauge');
  });
});
