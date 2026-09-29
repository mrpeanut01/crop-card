/**
 * 32D offline recovery through the real Dexie queue (fake-indexeddb): a
 * replayed 422 parks a row with what it can do next, later rows for the
 * same animals wait behind it (D1-09), "Save as discard" re-sends the same
 * client record id once (D0-11), "Keep animals here" sends nothing, and
 * feed use routes to its stock item.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { db, type PendingRecordKind, type PendingSprayRecord } from './dexie';
import { ACTIVE_OWNER_ENDPOINT, EXPECTED_OWNER_HEADER } from './ownerSync';
import {
  drainQueue,
  endpointForRecord,
  enqueueRecord,
  listPendingForActiveOwner,
  recoverRejectedForActiveOwner
} from './syncQueue';
import { saveSnapshot } from './cardStore';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { sampleAnimalSnapshot } from '$lib/cards/build/fixturesAnimals';

const ACTIVE_KEY = 'cropcard.activeOwnerId';
const OWNER = 'owner_a';

interface Sent {
  url: string;
  id: string;
  body: Record<string, unknown>;
}

/** A fake server that holds the eggs of every subject in `held` and grazing
 *  on every Area in `heldAreas` for queued (live) moves. */
function installServer(
  opts: { held?: Set<string>; heldAreas?: Set<string>; refuseTasks?: boolean } = {}
): Sent[] {
  const sent: Sent[] = [];
  const saved = new Set<string>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === ACTIVE_OWNER_ENDPOINT) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'x-cropcard-owner': OWNER }),
          json: async () => ({ activeOwnerId: OWNER })
        };
      }
      const headers = init.headers as Record<string, string>;
      expect(headers[EXPECTED_OWNER_HEADER]).toBe(OWNER);
      const id = headers[CLIENT_RECORD_HEADER];
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      sent.push({ url, id, body });
      const reply = (status: number, json: unknown) => ({
        ok: status < 300,
        status,
        text: async () => JSON.stringify(json),
        json: async () => json
      });
      if (saved.has(id)) return reply(200, { ok: true, duplicate: true });
      const subject = `${body.subjectType}:${body.subjectId}`;
      if (
        url.endsWith('/production/record') &&
        (body.use === 'food' || body.use === 'sale') &&
        opts.held?.has(subject)
      ) {
        return reply(422, {
          code: 'WITHDRAWAL_UNKNOWN',
          error: 'These eggs are on hold.',
          resubmitAs: 'discard',
          overridable: false,
          askOwner: true
        });
      }
      if (url.endsWith('/tasks/close') && opts.refuseTasks) {
        return reply(422, { code: 'OUT_OF_ORDER', error: 'Change the date.' });
      }
      if (
        url.endsWith('/animals/move') &&
        body.queuedLive &&
        opts.heldAreas?.has(String(body.fieldId))
      ) {
        return reply(422, { code: 'GRAZING_UNKNOWN', error: 'Sprayed.', fieldId: body.fieldId });
      }
      saved.add(id);
      return reply(201, {});
    })
  );
  return sent;
}

function eggs(subjectId: string, use = 'food', subjectType = 'group') {
  return { subjectType, subjectId, kind: 'eggs', quantity: 12, unit: 'eggs', use };
}

async function row(id: string): Promise<PendingSprayRecord | undefined> {
  return db().pendingSprayRecords.get(id);
}

let clock = 1_000;
async function enqueue(kind: PendingRecordKind, payload: unknown, id: string): Promise<void> {
  const spy = vi.spyOn(Date, 'now').mockReturnValue((clock += 1_000));
  await enqueueRecord(kind, payload, id);
  spy.mockRestore();
}

beforeEach(async () => {
  await db().pendingSprayRecords.clear();
  await db().farmSnapshots.clear();
  sessionStorage.clear();
  sessionStorage.setItem(ACTIVE_KEY, OWNER);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a replayed 422 becomes a recoverable row', () => {
  it('parks the food log with its refusal, holds the next log for the flock, and sends other animals', async () => {
    const sent = installServer({ held: new Set(['group:g1']) });
    await enqueue('animal-production', eggs('g1'), 'rec-eggs-1');
    await enqueue('animal-production', eggs('g1', 'discard'), 'rec-eggs-2');
    await enqueue('animal-production', eggs('g2'), 'rec-eggs-3');

    const result = await drainQueue();
    expect(result.rejected.map((r) => r.id)).toEqual(['rec-eggs-1']);
    expect(result.heldBehindRejected).toEqual(['rec-eggs-2']);
    expect(result.succeeded).toEqual(['rec-eggs-3']);
    expect(sent.map((s) => s.id)).toEqual(['rec-eggs-1', 'rec-eggs-3']);

    const parked = await row('rec-eggs-1');
    expect(parked?.status).toBe('rejected');
    expect(parked?.rejectInfo).toEqual({
      code: 'WITHDRAWAL_UNKNOWN',
      error: 'These eggs are on hold.',
      resubmitAs: 'discard',
      askOwner: true
    });

    const again = await drainQueue();
    expect(again.heldBehindRejected).toEqual(['rec-eggs-2']);
    expect(sent).toHaveLength(2);
  });

  it('Save as discard re-sends the same record id once, then lets the flock’s next log through', async () => {
    const sent = installServer({ held: new Set(['group:g1']) });
    await enqueue('animal-production', eggs('g1'), 'rec-eggs-1');
    await enqueue('animal-production', eggs('g1', 'discard'), 'rec-eggs-2');
    await drainQueue();

    expect(await recoverRejectedForActiveOwner('rec-eggs-1', 'save-as-discard')).toBe(true);
    const rewritten = await row('rec-eggs-1');
    expect(rewritten?.status).toBeUndefined();
    expect(rewritten?.rejectInfo).toBeUndefined();
    expect(rewritten?.payload).toMatchObject({ use: 'discard', convertedFromUse: 'food' });

    const result = await drainQueue();
    expect(result.succeeded).toEqual(['rec-eggs-1', 'rec-eggs-2']);
    const resent = sent.filter((s) => s.id === 'rec-eggs-1');
    expect(resent).toHaveLength(2);
    expect(resent[1].body).toMatchObject({ use: 'discard', convertedFromUse: 'food' });
    expect(await listPendingForActiveOwner()).toHaveLength(0);

    expect((await drainQueue()).succeeded).toEqual([]);
    expect(sent.filter((s) => s.id === 'rec-eggs-1')).toHaveLength(2);
  });

  it('holds the flock’s egg logs behind a refused care-task Done that carries a dose', async () => {
    const sent = installServer({ refuseTasks: true });
    await enqueue(
      'task',
      {
        taskId: 't_worm',
        action: 'complete',
        healthEvent: { subjectType: 'group', subjectId: 'g1', kind: 'deworm' }
      },
      'rec-task'
    );
    await enqueue('animal-production', eggs('g1'), 'rec-eggs-after');
    await enqueue('animal-production', eggs('g2'), 'rec-eggs-other');
    const result = await drainQueue();
    expect(result.rejected.map((r) => r.id)).toEqual(['rec-task']);
    expect(result.heldBehindRejected).toEqual(['rec-eggs-after']);
    expect(sent.map((s) => s.id)).toEqual(['rec-task', 'rec-eggs-other']);
  });

  it('holds a member’s log behind its flock’s refused row through the saved snapshot', async () => {
    installServer({ held: new Set(['group:g_layers']) });
    expect(await saveSnapshot(sampleAnimalSnapshot({ ownerId: OWNER }), null)).toBe(true);
    await enqueue('animal-production', eggs('g_layers'), 'rec-flock');
    await enqueue('animal-production', eggs('a_hen1', 'food', 'animal'), 'rec-hen');
    await enqueue('animal-production', eggs('a_goat', 'food', 'animal'), 'rec-goat');
    const result = await drainQueue();
    expect(result.rejected.map((r) => r.id)).toEqual(['rec-flock']);
    expect(result.heldBehindRejected).toEqual(['rec-hen']);
    expect(result.succeeded).toEqual(['rec-goat']);
  });

  it('Keep animals here drops a refused move and sends nothing; They already went resends without the flag', async () => {
    const sent = installServer({ heldAreas: new Set(['f_pasture']) });
    const move = {
      subjectType: 'group',
      subjectId: 'g1',
      fieldId: 'f_pasture',
      movedAt: 500,
      queuedLive: true
    };
    await enqueue('animal-move', move, 'rec-move-1');
    await enqueue('animal-move', { ...move, subjectId: 'g2' }, 'rec-move-2');
    await drainQueue();
    expect((await row('rec-move-1'))?.rejectInfo?.code).toBe('GRAZING_UNKNOWN');

    expect(await recoverRejectedForActiveOwner('rec-move-1', 'save-as-discard')).toBe(false);
    expect(await recoverRejectedForActiveOwner('rec-move-1', 'keep-here')).toBe(true);
    expect(await row('rec-move-1')).toBeUndefined();

    expect(await recoverRejectedForActiveOwner('rec-move-2', 'already-went')).toBe(true);
    const before = sent.length;
    const result = await drainQueue();
    expect(result.succeeded).toEqual(['rec-move-2']);
    expect(sent).toHaveLength(before + 1);
    expect(sent.at(-1)?.id).toBe('rec-move-2');
    expect(sent.at(-1)?.body.queuedLive).toBeUndefined();
    expect(sent.at(-1)?.body.alreadyThere).toBe(true);
    expect(sent.filter((s) => s.id === 'rec-move-1')).toHaveLength(1);
  });

  it('never recovers another Owner’s row or a row that was not refused', async () => {
    installServer({ held: new Set(['group:g1']) });
    await enqueue('animal-production', eggs('g1'), 'rec-mine');
    await drainQueue();
    sessionStorage.setItem(ACTIVE_KEY, 'owner_b');
    expect(await recoverRejectedForActiveOwner('rec-mine', 'save-as-discard')).toBe(false);
    sessionStorage.setItem(ACTIVE_KEY, OWNER);
    await enqueue('animal-production', eggs('g9'), 'rec-waiting');
    expect(await recoverRejectedForActiveOwner('rec-waiting', 'save-as-discard')).toBe(false);
  });

  it('a 422 never leaves a stuck row: every refused food log ends saved once as discarded (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            subject: fc.constantFrom('g1', 'g2', 'g3'),
            use: fc.constantFrom('food', 'sale', 'discard', 'unknown')
          }),
          { minLength: 1, maxLength: 12 }
        ),
        fc.subarray(['group:g1', 'group:g2', 'group:g3']),
        async (logs, heldSubjects) => {
          await db().pendingSprayRecords.clear();
          const sent = installServer({ held: new Set(heldSubjects) });
          for (let i = 0; i < logs.length; i++) {
            await enqueue('animal-production', eggs(logs[i].subject, logs[i].use), `rec-${i}`);
          }
          for (let round = 0; round < logs.length + 2; round++) {
            await drainQueue();
            for (const r of await listPendingForActiveOwner()) {
              if (r.status === 'rejected') {
                expect(await recoverRejectedForActiveOwner(r.id, 'save-as-discard')).toBe(true);
              }
            }
          }
          expect(await listPendingForActiveOwner()).toHaveLength(0);
          const savedIds = new Set<string>();
          for (const s of sent) {
            const ok = !(
              (s.body.use === 'food' || s.body.use === 'sale') &&
              heldSubjects.includes(`group:${s.body.subjectId}`)
            );
            if (ok) {
              expect(savedIds.has(s.id)).toBe(false);
              savedIds.add(s.id);
            }
          }
          expect(savedIds.size).toBe(logs.length);
          vi.unstubAllGlobals();
        }
      ),
      { numRuns: 40 }
    );
  });
});

describe('feed use (D1-16)', () => {
  it('routes to its stock item and keeps the id out of the body', async () => {
    const sent = installServer();
    await enqueue(
      'feed-use',
      { stockItemId: 'st_1', lb: 3, subjectType: 'group', subjectId: 'g1' },
      'rec-feed'
    );
    const result = await drainQueue();
    expect(result.succeeded).toEqual(['rec-feed']);
    expect(sent[0].url).toBe('/api/stock/st_1/use');
    expect(sent[0].body).toMatchObject({ lb: 3, subjectType: 'group', subjectId: 'g1' });
    expect(sent[0].body.stockItemId).toBeUndefined();
    expect(typeof sent[0].body.occurredAt).toBe('number');
  });

  it('never builds a path from an unsafe id', () => {
    expect(endpointForRecord({ kind: 'feed-use', payload: { stockItemId: '../admin' } })).toBe(
      '/api/stock/_/use'
    );
  });
});
