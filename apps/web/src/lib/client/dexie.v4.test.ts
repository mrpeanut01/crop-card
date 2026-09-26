import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { db } from './dexie';

describe('Dexie v4 upgrade', () => {
  it('keeps v3 queue and catalog rows and adds the Card tables', async () => {
    const v3 = new Dexie('cropcard');
    v3.version(3).stores({
      pendingSprayRecords: 'id, ownerId, createdAt, [ownerId+createdAt]',
      cachedCatalogs: 'key, ownerId, [ownerId+catalogKind]'
    });
    await v3.table('pendingSprayRecords').put({
      id: 'r1',
      ownerId: 'owner_a',
      kind: 'fungicide',
      occurredAt: 1,
      payload: { x: 1 },
      attempts: 0,
      createdAt: 1
    });
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
    expect(d.verno).toBe(4);
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
});
