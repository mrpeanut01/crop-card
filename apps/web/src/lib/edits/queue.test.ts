import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { pendingSummary, queueKindLabel, recoveryFor } from '$lib/animals/queueRecovery';
import { db } from '$lib/client/dexie';
import { ACTIVE_OWNER_ENDPOINT } from '$lib/client/ownerSync';
import {
  bodyForRecord,
  drainQueue,
  endpointForRecord,
  methodForRecord,
  resolveEditConflictForActiveOwner,
  retryRejectedForActiveOwner
} from '$lib/client/syncQueue';
import {
  EDIT_CONFLICT_CODE,
  EDIT_FIELDS_BY_ACTION,
  editConflicts,
  type EditField,
  type EditValues
} from './conflict';
import {
  enqueueRecordEdit,
  isRecordEditPayload,
  recordEditPath,
  runRecordEdits,
  sendRecordEdit,
  type RecordEditPayload
} from './queue';

const OWNER = 'owner_a';

function payload(over: Partial<RecordEditPayload['body']> = {}): RecordEditPayload {
  return {
    target: 'planting',
    id: 'crop_1',
    label: 'Cherokee Purple',
    body: {
      action: 'edit-details',
      varietyDisplayName: 'Mine',
      base: { varietyDisplayName: 'Original' },
      ...over
    }
  };
}

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

beforeEach(async () => {
  await db().pendingSprayRecords.clear();
  sessionStorage.clear();
  sessionStorage.setItem('cropcard.activeOwnerId', OWNER);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('record-edit routing (U-02)', () => {
  it('PATCHes the planting or task path with the body only', () => {
    const rec = { kind: 'record-edit' as const, payload: payload() };
    expect(endpointForRecord(rec)).toBe('/api/crops/crop_1');
    expect(endpointForRecord({ ...rec, payload: { ...payload(), target: 'task' } })).toBe(
      '/api/tasks/crop_1'
    );
    expect(methodForRecord(rec)).toBe('PATCH');
    expect(methodForRecord({ kind: 'harvest' })).toBe('POST');
    expect(bodyForRecord(rec)).toEqual(payload().body);
  });

  it('never routes a malformed payload or an unsafe id', () => {
    expect(endpointForRecord({ kind: 'record-edit', payload: { id: 'x' } })).toBeNull();
    expect(recordEditPath('planting', '../admin')).toBeNull();
    expect(isRecordEditPayload(payload())).toBe(true);
    expect(isRecordEditPayload({ ...payload(), body: { action: 'x' } })).toBe(false);
  });

  it('labels the row with what was edited', () => {
    expect(queueKindLabel('record-edit')).toBe('Edit');
    expect(queueKindLabel('record-edit', 'es')).toBe('Cambio');
    expect(pendingSummary('record-edit', payload())).toBe('Cherokee Purple');
    expect(
      recoveryFor({ kind: 'record-edit', lastStatus: 409, payload: payload() }).actions
    ).toEqual([]);
  });
});

describe('sendRecordEdit (U-01)', () => {
  it('sends online with a client record id and queues nothing', async () => {
    const fetchFn = vi.fn(async () => reply(200, { crop: { id: 'crop_1' } }));
    const out = await sendRecordEdit(payload(), { fetchFn: fetchFn as never, online: true });
    expect(out.status).toBe('saved');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/crops/crop_1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual(payload().body);
    expect((init.headers as Record<string, string>)[CLIENT_RECORD_HEADER]).toBeTruthy();
    expect(await db().pendingSprayRecords.count()).toBe(0);
  });

  it('queues under the same id on a network error', async () => {
    let sentId = '';
    const fetchFn = vi.fn(async (_u: string, init: RequestInit) => {
      sentId = (init.headers as Record<string, string>)[CLIENT_RECORD_HEADER];
      throw new TypeError('Failed to fetch');
    });
    const out = await sendRecordEdit(payload(), { fetchFn: fetchFn as never, online: true });
    expect(out).toEqual({ status: 'queued', rowId: sentId });
    const row = await db().pendingSprayRecords.get(sentId);
    expect(row?.kind).toBe('record-edit');
    expect(row?.ownerId).toBe(OWNER);
    expect(row?.payload).toEqual(payload());
  });

  it('queues on a 5xx and on the updating 503', async () => {
    for (const res of [
      reply(500, { error: 'boom' }),
      reply(503, { code: 'SERVER_UPDATING' }, { 'x-cropcard-updating': '1', 'retry-after': '5' })
    ]) {
      const out = await sendRecordEdit(payload(), {
        fetchFn: (async () => res) as never,
        online: true
      });
      expect(out.status).toBe('queued');
    }
    expect(await db().pendingSprayRecords.count()).toBe(2);
  });

  it('queues straight away when the phone is offline', async () => {
    const fetchFn = vi.fn();
    const out = await sendRecordEdit(payload(), { fetchFn: fetchFn as never, online: false });
    expect(out.status).toBe('queued');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('hands back a 409 EDIT_CONFLICT for the farmer to resolve', async () => {
    const body = {
      error: 'Someone else changed this while you were editing. Nothing was saved.',
      code: EDIT_CONFLICT_CODE,
      target: 'planting',
      id: 'crop_1',
      action: 'edit-details',
      fields: [{ field: 'varietyDisplayName', base: 'Original', mine: 'Mine', theirs: 'Theirs' }],
      current: { varietyDisplayName: 'Theirs' }
    };
    const out = await sendRecordEdit(payload(), {
      fetchFn: (async () => reply(409, body)) as never,
      online: true
    });
    expect(out).toEqual({ status: 'conflict', conflict: body });
    expect(await db().pendingSprayRecords.count()).toBe(0);
  });

  it('passes other refusals through', async () => {
    const out = await sendRecordEdit(payload(), {
      fetchFn: (async () => reply(403, { error: 'Ask the owner.' })) as never,
      online: true
    });
    expect(out).toEqual({ status: 'refused', error: 'Ask the owner.', httpStatus: 403 });
  });
});

describe('runRecordEdits', () => {
  it('queues the rest once one edit is queued', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('offline');
    });
    const sched = payload({ action: 'set-schedule', plantingDate: 5, base: { plantingDate: 1 } });
    const out = await runRecordEdits([sched, payload()], {
      fetchFn: fetchFn as never,
      online: true
    });
    expect(out).toEqual({ status: 'done', saved: 0, queued: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await db().pendingSprayRecords.count()).toBe(2);
  });

  it('stops at a conflict and returns the refused edit with the ones not sent', async () => {
    const conflict = {
      error: 'x',
      code: EDIT_CONFLICT_CODE,
      target: 'planting',
      id: 'crop_1',
      action: 'set-schedule',
      fields: [{ field: 'plantingDate', base: 1, mine: 5, theirs: 3 }],
      current: { plantingDate: 3 }
    };
    const fetchFn = vi.fn(async () => reply(409, conflict));
    const sched = payload({ action: 'set-schedule', plantingDate: 5, base: { plantingDate: 1 } });
    const out = await runRecordEdits([sched, payload()], {
      fetchFn: fetchFn as never,
      online: true
    });
    expect(out.status).toBe('conflict');
    if (out.status === 'conflict') expect(out.remaining).toEqual([sched, payload()]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

/** A fake server holding one planting that applies the real C-E1 check. */
function installServer(row: EditValues): { sent: string[]; row: EditValues } {
  const state = { sent: [] as string[], row };
  const saved = new Set<string>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === ACTIVE_OWNER_ENDPOINT) {
        return reply(200, { activeOwnerId: OWNER }, { 'x-cropcard-owner': OWNER });
      }
      const id = (init.headers as Record<string, string>)[CLIENT_RECORD_HEADER];
      state.sent.push(`${init.method} ${url}`);
      if (saved.has(id)) return reply(200, { ok: true, duplicate: true });
      const body = JSON.parse(String(init.body)) as Record<string, unknown> & {
        action: string;
        base?: EditValues;
      };
      const fields = EDIT_FIELDS_BY_ACTION[`planting:${body.action}`] ?? [];
      const mine: EditValues = {};
      for (const f of fields) if (body[f] !== undefined) mine[f] = body[f] as never;
      const conflicts = body.base ? editConflicts(body.base, mine, state.row) : [];
      if (conflicts.length > 0) {
        return reply(409, {
          error: 'Someone else changed this while you were editing. Nothing was saved.',
          code: EDIT_CONFLICT_CODE,
          target: 'planting',
          id: 'crop_1',
          action: body.action,
          fields: conflicts,
          current: { ...state.row }
        });
      }
      for (const [k, v] of Object.entries(mine)) state.row[k as EditField] = v as never;
      saved.add(id);
      return reply(200, { crop: state.row });
    })
  );
  return state;
}

describe('offline replay with a conflict (U-03, U-04)', () => {
  it('parks the row with the conflict, then Keep mine saves it once', async () => {
    const server = installServer({ varietyDisplayName: 'Theirs', quantityPlanted: 10 });
    const id = await enqueueRecordEdit(payload());
    const first = await drainQueue();
    expect(first.rejected.map((r) => r.id)).toEqual([id]);
    const parked = await db().pendingSprayRecords.get(id);
    expect(parked?.status).toBe('rejected');
    expect(parked?.editConflict?.fields.map((f) => f.field)).toEqual(['varietyDisplayName']);

    expect(await resolveEditConflictForActiveOwner(id, 'mine')).toBe('resend');
    const ready = await db().pendingSprayRecords.get(id);
    expect(ready?.status).toBeUndefined();
    expect(ready?.editConflict).toBeUndefined();
    const second = await drainQueue();
    expect(second.succeeded).toEqual([id]);
    expect(server.row.varietyDisplayName).toBe('Mine');
    expect(server.sent.every((s) => s.startsWith('PATCH /api/crops/crop_1'))).toBe(true);
  });

  it('Keep theirs deletes the row and sends nothing', async () => {
    const server = installServer({ varietyDisplayName: 'Theirs' });
    const id = await enqueueRecordEdit(payload());
    await drainQueue();
    expect(await resolveEditConflictForActiveOwner(id, 'theirs')).toBe('dropped');
    expect(await db().pendingSprayRecords.count()).toBe(0);
    expect(server.sent).toHaveLength(1);
    expect(server.row.varietyDisplayName).toBe('Theirs');
  });

  it('Choose for each keeps the fields that did not conflict', async () => {
    const server = installServer({ varietyDisplayName: 'Theirs', quantityPlanted: 10 });
    const id = await enqueueRecordEdit(
      payload({
        quantityPlanted: 25,
        base: { varietyDisplayName: 'Original', quantityPlanted: 10 }
      })
    );
    await drainQueue();
    const parked = await db().pendingSprayRecords.get(id);
    expect(parked?.editConflict?.fields.map((f) => f.field)).toEqual(['varietyDisplayName']);
    expect(
      await resolveEditConflictForActiveOwner(id, { merge: { varietyDisplayName: 'theirs' } })
    ).toBe('resend');
    await drainQueue();
    expect(server.row).toEqual({ varietyDisplayName: 'Theirs', quantityPlanted: 25 });
  });

  it('a later row for the same planting is not held back', async () => {
    installServer({ varietyDisplayName: 'Theirs', quantityPlanted: 10 });
    const a = await enqueueRecordEdit(payload());
    const b = await enqueueRecordEdit(
      payload({ varietyDisplayName: undefined, quantityPlanted: 3, base: { quantityPlanted: 10 } })
    );
    const out = await drainQueue();
    expect(out.rejected.map((r) => r.id)).toEqual([a]);
    expect(out.succeeded).toEqual([b]);
  });

  it('only resolves the active Owner’s conflicted rows', async () => {
    installServer({ varietyDisplayName: 'Theirs' });
    const id = await enqueueRecordEdit(payload());
    await drainQueue();
    sessionStorage.setItem('cropcard.activeOwnerId', 'owner_b');
    expect(await resolveEditConflictForActiveOwner(id, 'mine')).toBeNull();
    sessionStorage.setItem('cropcard.activeOwnerId', OWNER);
    expect(await resolveEditConflictForActiveOwner('nope', 'mine')).toBeNull();
  });

  it('a planting deleted on another device parks the row as a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === ACTIVE_OWNER_ENDPOINT
          ? reply(200, { activeOwnerId: OWNER }, { 'x-cropcard-owner': OWNER })
          : reply(404, { message: 'crop not found' })
      )
    );
    const id = await enqueueRecordEdit(payload());
    const out = await drainQueue();
    expect(out.rejected.map((r) => r.id)).toEqual([id]);
    const row = await db().pendingSprayRecords.get(id);
    expect(row?.lastStatus).toBe(404);
    expect(row?.editConflict).toBeUndefined();
    expect(await resolveEditConflictForActiveOwner(id, 'mine')).toBeNull();
  });

  it('Retry clears the stored conflict', async () => {
    installServer({ varietyDisplayName: 'Theirs' });
    const id = await enqueueRecordEdit(payload());
    await drainQueue();
    expect(await retryRejectedForActiveOwner(id)).toBe(true);
    expect((await db().pendingSprayRecords.get(id))?.editConflict).toBeUndefined();
  });
});
