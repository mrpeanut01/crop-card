import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { db } from './dexie';

const V6_STORES = {
  pendingSprayRecords: 'id, ownerId, createdAt, [ownerId+createdAt], [ownerId+kind]',
  cachedCatalogs: 'key, ownerId, [ownerId+catalogKind]',
  farmSnapshots: 'ownerId',
  pinnedCards: '[ownerId+key], ownerId, [ownerId+pinnedAt]',
  recordCards: '[ownerId+key], ownerId, [ownerId+lastOpenedAt]',
  taskTimers: '[ownerId+userId], ownerId'
};

beforeEach(async () => {
  db().close();
  await Dexie.delete('cropcard');
});

function queueRow(id: string, ownerId: string, kind: string) {
  return { id, ownerId, kind, occurredAt: 1, payload: { x: id }, attempts: 0, createdAt: 1 };
}

describe('Dexie v7 upgrade (#869)', () => {
  it('keeps every v6 row, card, timer and snapshot, and adds an empty journalCopies store', async () => {
    const v6 = new Dexie('cropcard');
    v6.version(6).stores(V6_STORES);
    const rows = [queueRow('j1', 'owner_a', 'journal'), queueRow('t1', 'owner_b', 'time-entry')];
    await v6.table('pendingSprayRecords').bulkPut(rows);
    await v6.table('pinnedCards').put({ ownerId: 'owner_a', key: 'pl_1', pinnedAt: 9 });
    await v6
      .table('farmSnapshots')
      .put({ ownerId: 'owner_a', etag: 'W/"3"', fetchedAt: 3, bundle: { cards: [] } });
    await v6.table('recordCards').put({
      ownerId: 'owner_a',
      key: 'rc_spray.1',
      model: { a: 1 },
      savedAt: 1,
      lastOpenedAt: 2
    });
    await v6
      .table('taskTimers')
      .put({ ownerId: 'owner_b', userId: 'u1', taskId: 't9', startedAt: 7 });
    await v6.table('cachedCatalogs').put({
      key: 'owner_a:plugins',
      ownerId: 'owner_a',
      catalogKind: 'plugins',
      body: [],
      fetchedAt: 4
    });
    v6.close();

    const d = db();
    await d.open();
    expect(d.verno).toBe(7);
    expect(await d.pendingSprayRecords.toArray()).toEqual(expect.arrayContaining(rows));
    expect(await d.pinnedCards.get(['owner_a', 'pl_1'])).toMatchObject({ pinnedAt: 9 });
    expect(await d.farmSnapshots.get('owner_a')).toMatchObject({ etag: 'W/"3"' });
    expect(await d.recordCards.get(['owner_a', 'rc_spray.1'])).toMatchObject({ lastOpenedAt: 2 });
    expect(await d.taskTimers.get(['owner_b', 'u1'])).toMatchObject({ taskId: 't9' });
    expect(await d.cachedCatalogs.get('owner_a:plugins')).toBeDefined();
    expect(await d.journalCopies.count()).toBe(0);
    expect(d.journalCopies.schema.primKey.keyPath).toEqual(['ownerId', 'entryId']);
    expect(d.journalCopies.schema.idxByName['[ownerId+cropId]']).toBeDefined();
  });

  it('keys journal copies by Owner and entry, and finds them by Owner and planting', async () => {
    const d = db();
    await d.open();
    const row = (ownerId: string, entryId: string, cropId: string) => ({
      ownerId,
      entryId,
      cropId,
      createdAt: 1,
      savedAt: 1,
      bytes: 10,
      entry: {},
      photo: 'data:image/jpeg;base64,AAAA'
    });
    await d.journalCopies.bulkPut([
      row('owner_a', 'e1', 'crop_1'),
      row('owner_b', 'e1', 'crop_1'),
      row('owner_a', 'e2', 'crop_2')
    ]);
    expect(
      (await d.journalCopies.where('[ownerId+cropId]').equals(['owner_a', 'crop_1']).toArray()).map(
        (r) => r.ownerId
      )
    ).toEqual(['owner_a']);
    expect(await d.journalCopies.where('ownerId').equals('owner_a').count()).toBe(2);
  });
});
