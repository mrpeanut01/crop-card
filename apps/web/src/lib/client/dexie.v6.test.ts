import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { db } from './dexie';
import { ENDPOINT_BY_KIND } from './syncQueue';

const V5_STORES = {
  pendingSprayRecords: 'id, ownerId, createdAt, [ownerId+createdAt], [ownerId+kind]',
  cachedCatalogs: 'key, ownerId, [ownerId+catalogKind]',
  farmSnapshots: 'ownerId',
  pinnedCards: '[ownerId+key], ownerId, [ownerId+pinnedAt]'
};

beforeEach(async () => {
  db().close();
  await Dexie.delete('cropcard');
});

function queueRow(id: string, ownerId: string, kind: string, extra: object = {}) {
  return {
    id,
    ownerId,
    kind,
    occurredAt: 1,
    payload: { x: id },
    attempts: 0,
    createdAt: 1,
    ...extra
  };
}

describe('Dexie v6 upgrade (A-12)', () => {
  it('keeps every v5 row, pin, snapshot and catalog, and adds two empty stores', async () => {
    const v5 = new Dexie('cropcard');
    v5.version(5).stores(V5_STORES);
    const rows = [
      queueRow('h1', 'owner_a', 'harvest'),
      queueRow('m1', 'owner_a', 'animal-move', { status: 'rejected', lastStatus: 422 }),
      queueRow('j1', 'owner_b', 'journal')
    ];
    await v5.table('pendingSprayRecords').bulkPut(rows);
    await v5.table('pinnedCards').put({ ownerId: 'owner_a', key: 'rc_spray.1', pinnedAt: 9 });
    await v5
      .table('farmSnapshots')
      .put({ ownerId: 'owner_b', etag: 'W/"7"', fetchedAt: 3, bundle: { cards: [] } });
    await v5.table('cachedCatalogs').put({
      key: 'owner_a:sprayers',
      ownerId: 'owner_a',
      catalogKind: 'sprayers',
      body: [{ id: 's' }],
      fetchedAt: 4
    });
    v5.close();

    const d = db();
    await d.open();
    expect(d.verno).toBe(6);
    expect(await d.pendingSprayRecords.toArray()).toEqual(expect.arrayContaining(rows));
    expect(await d.pendingSprayRecords.count()).toBe(3);
    expect(
      await d.pendingSprayRecords.where('[ownerId+kind]').equals(['owner_a', 'animal-move']).first()
    ).toMatchObject({ status: 'rejected', lastStatus: 422 });
    expect(await d.pinnedCards.get(['owner_a', 'rc_spray.1'])).toMatchObject({ pinnedAt: 9 });
    expect(await d.farmSnapshots.get('owner_b')).toMatchObject({ etag: 'W/"7"' });
    expect(await d.cachedCatalogs.get('owner_a:sprayers')).toMatchObject({ body: [{ id: 's' }] });

    expect(await d.recordCards.count()).toBe(0);
    expect(await d.taskTimers.count()).toBe(0);
    expect(d.recordCards.schema.primKey.keyPath).toEqual(['ownerId', 'key']);
    expect(d.taskTimers.schema.primKey.keyPath).toEqual(['ownerId', 'userId']);
  });

  it('keys record cards by Owner and key, and keeps one timer per Owner and user', async () => {
    const d = db();
    await d.open();
    await d.recordCards.bulkPut([
      { ownerId: 'owner_a', key: 'rc_spray.1', model: { a: 1 }, savedAt: 1, lastOpenedAt: 5 },
      { ownerId: 'owner_b', key: 'rc_spray.1', model: { b: 1 }, savedAt: 1, lastOpenedAt: 2 },
      { ownerId: 'owner_a', key: 'rc_harvest.2', model: {}, savedAt: 1, lastOpenedAt: 3 }
    ]);
    const aByRecent = await d.recordCards
      .where('[ownerId+lastOpenedAt]')
      .between(['owner_a', Dexie.minKey], ['owner_a', Dexie.maxKey])
      .reverse()
      .toArray();
    expect(aByRecent.map((r) => r.key)).toEqual(['rc_spray.1', 'rc_harvest.2']);
    expect((await d.recordCards.get(['owner_b', 'rc_spray.1']))?.model).toEqual({ b: 1 });

    await d.taskTimers.put({ ownerId: 'owner_a', userId: 'u1', taskId: 't1', startedAt: 1 });
    await d.taskTimers.put({ ownerId: 'owner_a', userId: 'u1', taskId: 't2', startedAt: 2 });
    await d.taskTimers.put({ ownerId: 'owner_b', userId: 'u1', taskId: 't3', startedAt: 3 });
    expect(await d.taskTimers.where('ownerId').equals('owner_a').toArray()).toEqual([
      { ownerId: 'owner_a', userId: 'u1', taskId: 't2', startedAt: 2 }
    ]);
  });
});

describe('Phase 33 queue kinds', () => {
  it('routes time-entry now that 33D wires the task timer (D-29)', () => {
    expect(ENDPOINT_BY_KIND['time-entry']).toBe('/api/tasks/:id/time');
  });
});
