import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleAnimalSnapshot } from '$lib/cards/build/fixturesAnimals';
import { clearCardCaches, saveSnapshot } from './cardStore';
import { checkFoodLog, loadUnsyncedSubjects } from './animalHold';
import {
  ONLINE_HOLD_WRITE_TTL_MS,
  clearOnlineHoldWritesBefore,
  listOnlineHoldWrites,
  noteOnlineHoldWrite
} from './onlineHoldWrites';
import { syncCardSnapshot } from './cardSync';
import { submitHealth } from '$lib/animals/recordClient';
import { submitMove } from '$lib/animals/moveClient';

const ACTIVE_KEY = 'cropcard.activeOwnerId';

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

beforeEach(async () => {
  await clearCardCaches();
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
  setOnline(false);
});

describe('online saves the snapshot does not show yet (D1-04)', () => {
  it("turns a clear egg check into can't confirm after a treatment saved online", async () => {
    const now = Date.now();
    const snapshot = sampleAnimalSnapshot({ generatedAt: now - 60_000, animalHolds: [] });
    const before = checkFoodLog({
      snapshot,
      subject: 'group:g_layers',
      food: 'eggs',
      use: 'food',
      now,
      unsynced: await loadUnsyncedSubjects(snapshot)
    });
    expect(before.verdict).toBe('clear');

    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ warnings: [] })));
    const out = await submitHealth(
      {
        subjectType: 'group',
        subjectId: 'g_layers',
        kind: 'deworm',
        productName: 'Wormer',
        administeredAt: now
      },
      fetchFn as never,
      () => true
    );
    expect(out.status).toBe('saved');

    const after = checkFoodLog({
      snapshot,
      subject: 'group:g_layers',
      food: 'eggs',
      use: 'food',
      now,
      unsynced: await loadUnsyncedSubjects(snapshot)
    });
    expect(after.verdict).toBe('unconfirmed');
    expect(after.reading?.unconfirmedReason).toBe('unsynced');
  });

  it('counts a move saved online for the moved group', async () => {
    const snapshot = sampleAnimalSnapshot({ generatedAt: Date.now(), animalHolds: [] });
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ move: { fieldId: 'f1', newGroup: null, capacity: null } }), {
          status: 201
        })
    );
    const out = await submitMove(
      { subjectType: 'group', subjectId: 'g_layers', fieldId: 'f_pasture' },
      fetchFn as never,
      () => true
    );
    expect(out.status).toBe('saved');
    expect((await loadUnsyncedSubjects(snapshot)).has('group:g_layers')).toBe(true);
  });

  it('keeps notes per Owner and drops them once a later fetch lands or they age out', async () => {
    noteOnlineHoldWrite('animal-health', { subjectType: 'group', subjectId: 'g_layers' }, 1000);
    expect(listOnlineHoldWrites(1000)).toHaveLength(1);
    sessionStorage.setItem(ACTIVE_KEY, 'owner_b');
    expect(listOnlineHoldWrites(1000)).toHaveLength(0);
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');

    clearOnlineHoldWritesBefore(999, 1000);
    expect(listOnlineHoldWrites(1000)).toHaveLength(1);
    expect(listOnlineHoldWrites(1000 + ONLINE_HOLD_WRITE_TTL_MS)).toHaveLength(0);
    clearOnlineHoldWritesBefore(1001, 1001);
    expect(listOnlineHoldWrites(1001)).toHaveLength(0);
  });

  it('clears a note only on a snapshot fetch that started after the save', async () => {
    const bundle = sampleAnimalSnapshot({ ownerId: 'owner_a' });
    await saveSnapshot(bundle, 'W/"v1"', 1);
    noteOnlineHoldWrite('animal-move', { subjectType: 'group', subjectId: 'g_layers' }, 5000);
    await new Promise((r) => setTimeout(r, 50));
    setOnline(true);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(bundle), { status: 200 }));
    expect(await syncCardSnapshot({ fetchImpl, now: () => 4000 })).toBe('updated');
    expect(listOnlineHoldWrites(5000)).toHaveLength(1);
    expect(await syncCardSnapshot({ fetchImpl, now: () => 6000 })).toBe('updated');
    expect(listOnlineHoldWrites(6000)).toHaveLength(0);
  });
});
