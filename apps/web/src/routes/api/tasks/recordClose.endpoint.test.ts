// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { owners, tasks, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { createTask, getTask, type Task } from '$lib/db/tasks';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { closeTaskForRecord, loadTaskContext } from '$lib/server/recordTaskClose';
import type { RecordTaskClose } from '$lib/tasks/recordClose';
import { POST as HARVEST } from '../harvest/record/+server';
import { POST as HAY } from '../hay/cuttings/+server';
import { POST as FERTILITY } from '../fertility/applications/+server';
import { POST as SCOUT } from '../scout/record/+server';

type Handler = (event: never) => Response | Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type Role = 'owner' | 'helper' | 'inspector';

const HOUR = 3_600_000;

for (const role of ['owner', 'helper', 'inspector']) {
  db.insert(users)
    .values({ id: `rtc-${role}`, email: `rtc-${role}@test.local` })
    .onConflictDoNothing()
    .run();
}

async function call(
  handler: unknown,
  ownerId: string,
  path: string,
  body: unknown,
  opts: { role?: Role; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: Json }> {
  const role = opts.role ?? 'owner';
  const url = new URL(`http://localhost${path}`);
  return runWithTenantAsync(ownerId, async () => {
    try {
      const res = await (handler as Handler)({
        params: {},
        url,
        request: new Request(url.href, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
          body: JSON.stringify(body)
        }),
        locals: {
          authVia: 'cookie',
          user: {
            id: `rtc-${role}`,
            email: null,
            phone: null,
            role,
            activeOwnerId: ownerId,
            isSuperadmin: false,
            impersonating: false
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
  blockId: string;
  otherBlockId: string;
  cropId: string;
  hayBlockId: string;
}

function seedFarm(label: string): Farm {
  const ownerId = `rtc-${label}-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  return runWithTenant(ownerId, () => {
    const garden = createField({ name: `${label} garden`, kind: 'garden' });
    const block = createBlock({ name: 'Bed 1', fieldId: garden.id, acres: 0.01 });
    const other = createBlock({ name: 'Bed 2', fieldId: garden.id, acres: 0.01 });
    const crop = createPlanned({
      blockId: block.id,
      cropPluginId: 'tomato-amish-paste',
      varietyDisplayName: 'Amish Paste'
    });
    const hayField = createField({ name: `${label} hayfield`, kind: 'field' });
    const hayBlock = createBlock({ name: 'Hay 1', fieldId: hayField.id, acres: 2 });
    return {
      ownerId,
      blockId: block.id,
      otherBlockId: other.id,
      cropId: crop.id,
      hayBlockId: hayBlock.id
    };
  });
}

function task(farm: Farm, fields: Partial<Parameters<typeof createTask>[0]> = {}): Task {
  return runWithTenant(farm.ownerId, () =>
    createTask({
      title: 'Do the job',
      kind: 'primary',
      scheduledFor: Date.now(),
      ...fields
    })
  );
}

function read(farm: Farm, id: string): Task | undefined {
  return runWithTenant(farm.ownerId, () => getTask(id));
}

function close(
  farm: Farm,
  taskId: string,
  record: { blockId: string; cropId?: string }
): RecordTaskClose {
  return runWithTenant(farm.ownerId, () =>
    closeTaskForRecord({
      taskId,
      record,
      eventTable: 'harvest_event',
      eventId: `evt-${randomUUID()}`,
      occurredAt: Date.now() - HOUR
    })
  ) as RecordTaskClose;
}

describe('closeTaskForRecord', () => {
  it('closes an open task and points it at the record', () => {
    const farm = seedFarm('close');
    const t = task(farm, { blockId: farm.blockId });
    const res = close(farm, t.id, { blockId: farm.blockId });
    expect(res).toEqual({ taskId: t.id, status: 'closed' });
    const after = read(farm, t.id)!;
    expect(after.completedAt).toBeLessThanOrEqual(Date.now() - HOUR + 1000);
    expect(after.relatedEventTable).toBe('harvest_event');
    expect(after.relatedEventId).toMatch(/^evt-/);
  });

  it('returns null with no task id', () => {
    const farm = seedFarm('none');
    expect(
      runWithTenant(farm.ownerId, () =>
        closeTaskForRecord({
          taskId: undefined,
          record: { blockId: farm.blockId },
          eventTable: 'harvest_event',
          eventId: 'e',
          occurredAt: Date.now()
        })
      )
    ).toBeNull();
  });

  it('leaves a completed or aborted task exactly as it was', () => {
    const farm = seedFarm('closed');
    const t = task(farm);
    expect(close(farm, t.id, { blockId: farm.blockId }).status).toBe('closed');
    const first = read(farm, t.id)!;
    expect(close(farm, t.id, { blockId: farm.blockId }).status).toBe('already-closed');
    expect(read(farm, t.id)).toEqual(first);

    const aborted = task(farm);
    runWithTenant(farm.ownerId, () =>
      db
        .update(tasks)
        .set({ abortedAt: new Date(), abortReason: 'rain' })
        .where(withTenant(tasks, eq(tasks.id, aborted.id)))
        .run()
    );
    const before = read(farm, aborted.id)!;
    expect(close(farm, aborted.id, { blockId: farm.blockId }).status).toBe('already-closed');
    expect(read(farm, aborted.id)).toEqual(before);
  });

  it('a different block, planting or crop leaves the task open', () => {
    const farm = seedFarm('mismatch');
    const byBlock = task(farm, { blockId: farm.blockId });
    expect(close(farm, byBlock.id, { blockId: farm.otherBlockId }).status).toBe('mismatch');
    expect(read(farm, byBlock.id)!.completedAt).toBeUndefined();

    const byCrop = task(farm, { cropId: farm.cropId });
    const other = runWithTenant(farm.ownerId, () =>
      createPlanned({
        blockId: farm.blockId,
        cropPluginId: 'tomato-amish-paste',
        varietyDisplayName: 'Second sowing'
      })
    );
    expect(close(farm, byCrop.id, { blockId: farm.blockId, cropId: other.id }).status).toBe(
      'mismatch'
    );
    const byPlugin = runWithTenant(farm.ownerId, () =>
      closeTaskForRecord({
        taskId: byCrop.id,
        record: { blockId: farm.blockId, cropPluginId: 'pepper-cubanelle' },
        eventTable: 'harvest_event',
        eventId: 'e',
        occurredAt: Date.now()
      })
    );
    expect(byPlugin?.status).toBe('mismatch');
    // The task's crop lives on Bed 1, so a Bed 2 record is another block.
    expect(close(farm, byCrop.id, { blockId: farm.otherBlockId }).status).toBe('mismatch');
    expect(read(farm, byCrop.id)!.completedAt).toBeUndefined();
  });

  it('an unknown id or another Owner task is not found and untouched', () => {
    const a = seedFarm('tenant-a');
    const b = seedFarm('tenant-b');
    const theirs = task(b);
    expect(close(a, theirs.id, { blockId: a.blockId }).status).toBe('not-found');
    expect(close(a, 'no-such-task', { blockId: a.blockId }).status).toBe('not-found');
    expect(read(b, theirs.id)!.completedAt).toBeUndefined();
  });

  it('care and seed-start tasks never close from a record', () => {
    const farm = seedFarm('special');
    const care = task(farm);
    runWithTenant(farm.ownerId, () =>
      db
        .update(tasks)
        .set({
          category: 'animal-care',
          recurrenceJson: JSON.stringify({
            care: 1,
            subjectType: 'animal',
            subjectId: 'an-1',
            planId: 'pl-1',
            dueOn: '2026-10-01',
            careKind: 'vaccination'
          })
        })
        .where(withTenant(tasks, eq(tasks.id, care.id)))
        .run()
    );
    const seed = task(farm, {
      cropId: farm.cropId,
      pluginTemplateKey: `seedstart:${farm.cropId}:sow`
    });
    expect(close(farm, care.id, { blockId: farm.blockId }).status).toBe('not-closable');
    expect(close(farm, seed.id, { blockId: farm.blockId }).status).toBe('not-closable');
    expect(read(farm, care.id)!.completedAt).toBeUndefined();
    expect(read(farm, seed.id)!.completedAt).toBeUndefined();
    expect(runWithTenant(farm.ownerId, () => loadTaskContext(care.id))).toBeNull();
    expect(runWithTenant(farm.ownerId, () => loadTaskContext(seed.id))).toBeNull();
  });
});

describe('loadTaskContext', () => {
  it('fills the block from the planting and is null for closed or foreign tasks', () => {
    const a = seedFarm('ctx-a');
    const b = seedFarm('ctx-b');
    const t = task(a, { cropId: a.cropId, title: 'Pick tomatoes' });
    expect(runWithTenant(a.ownerId, () => loadTaskContext(t.id))).toEqual({
      id: t.id,
      title: 'Pick tomatoes',
      blockId: a.blockId,
      cropId: a.cropId,
      cropPluginId: 'tomato-amish-paste'
    });
    expect(runWithTenant(b.ownerId, () => loadTaskContext(t.id))).toBeNull();
    expect(runWithTenant(a.ownerId, () => loadTaskContext(null))).toBeNull();
    close(a, t.id, { blockId: a.blockId });
    expect(runWithTenant(a.ownerId, () => loadTaskContext(t.id))).toBeNull();
  });
});

describe('record endpoints close the task they were started from', () => {
  it('harvest closes once, however many times the offline row replays', async () => {
    const farm = seedFarm('harvest');
    const t = task(farm, { cropId: farm.cropId, blockId: farm.blockId });
    const headers = { [CLIENT_RECORD_HEADER]: `rtc-${randomUUID()}` };
    const body = {
      blockId: farm.blockId,
      cropPluginId: 'tomato-amish-paste',
      quantity: '12 lb',
      taskId: t.id
    };
    const first = await call(HARVEST, farm.ownerId, '/api/harvest/record', body, {
      role: 'helper',
      headers
    });
    expect(first.status).toBe(200);
    expect(first.body.taskClose).toEqual({ taskId: t.id, status: 'closed' });
    const closed = read(farm, t.id)!;
    expect(closed.relatedEventTable).toBe('harvest_event');
    expect(closed.relatedEventId).toBe(first.body.event.id);

    const replay = await call(HARVEST, farm.ownerId, '/api/harvest/record', body, {
      role: 'helper',
      headers
    });
    expect(replay.body.duplicate).toBe(true);
    const again = await call(HARVEST, farm.ownerId, '/api/harvest/record', body, {
      headers: { [CLIENT_RECORD_HEADER]: `rtc-${randomUUID()}` }
    });
    expect(again.body.taskClose.status).toBe('already-closed');
    expect(read(farm, t.id)).toEqual(closed);
  });

  it('harvest of another crop saves and leaves the task open', async () => {
    const farm = seedFarm('harvest-mismatch');
    const t = task(farm, { cropId: farm.cropId });
    const res = await call(HARVEST, farm.ownerId, '/api/harvest/record', {
      blockId: farm.otherBlockId,
      cropPluginId: 'tomato-amish-paste',
      quantity: '3 lb',
      taskId: t.id
    });
    expect(res.status).toBe(200);
    expect(res.body.taskClose.status).toBe('mismatch');
    expect(read(farm, t.id)!.completedAt).toBeUndefined();
  });

  it('a record with no task id answers taskClose null', async () => {
    const farm = seedFarm('harvest-plain');
    const res = await call(HARVEST, farm.ownerId, '/api/harvest/record', {
      blockId: farm.blockId,
      cropPluginId: 'tomato-amish-paste'
    });
    expect(res.status).toBe(200);
    expect(res.body.taskClose).toBeNull();
  });

  it('an inspector is refused before anything closes', async () => {
    const farm = seedFarm('scout-inspector');
    const t = task(farm, { blockId: farm.blockId });
    const res = await call(
      SCOUT,
      farm.ownerId,
      '/api/scout/record',
      { blockId: farm.blockId, pest: 'note', metric: 'note', value: 0, taskId: t.id },
      { role: 'inspector' }
    );
    expect(res.status).toBe(403);
    expect(read(farm, t.id)!.completedAt).toBeUndefined();
  });

  it('scout: the first matching observation closes, later ones say nothing new', async () => {
    const farm = seedFarm('scout');
    const t = task(farm, { blockId: farm.blockId });
    const body = { blockId: farm.blockId, pest: 'aphid', metric: 'per-leaf', value: 2 };
    const first = await call(
      SCOUT,
      farm.ownerId,
      '/api/scout/record',
      { ...body, taskId: t.id },
      { role: 'helper', headers: { [CLIENT_RECORD_HEADER]: `rtc-${randomUUID()}` } }
    );
    expect(first.status).toBe(201);
    expect(first.body.taskClose.status).toBe('closed');
    const after = read(farm, t.id)!;
    expect(after.relatedEventTable).toBe('scout_observation');
    expect(after.relatedEventId).toBe(first.body.observation.id);
    const second = await call(SCOUT, farm.ownerId, '/api/scout/record', {
      ...body,
      taskId: t.id
    });
    expect(second.body.taskClose.status).toBe('already-closed');
    expect(read(farm, t.id)).toEqual(after);
  });

  it('hay: creating the cutting closes the task', async () => {
    const farm = seedFarm('hay');
    const t = task(farm, { blockId: farm.hayBlockId });
    const headers = { [CLIENT_RECORD_HEADER]: `rtc-${randomUUID()}` };
    const body = { blockId: farm.hayBlockId, cropPluginId: 'alfalfa-vernema', taskId: t.id };
    const res = await call(HAY, farm.ownerId, '/api/hay/cuttings', body, {
      role: 'helper',
      headers
    });
    expect(res.status).toBe(201);
    expect(res.body.taskClose.status).toBe('closed');
    const after = read(farm, t.id)!;
    expect(after.relatedEventTable).toBe('hay_cutting');
    expect(after.relatedEventId).toBe(res.body.cutting.id);
    const replay = await call(HAY, farm.ownerId, '/api/hay/cuttings', body, { headers });
    expect(replay.body.duplicate).toBe(true);
    expect(read(farm, t.id)).toEqual(after);
  });

  it('fertility closes in the same write, owner only', async () => {
    const farm = seedFarm('fert');
    const t = task(farm, { blockId: farm.blockId });
    const body = {
      blockId: farm.blockId,
      source: '10-10-10',
      ratePerAcre: 200,
      rateUnit: 'lb-per-acre',
      taskId: t.id
    };
    const helper = await call(FERTILITY, farm.ownerId, '/api/fertility/applications', body, {
      role: 'helper'
    });
    expect(helper.status).toBe(403);
    expect(read(farm, t.id)!.completedAt).toBeUndefined();

    const res = await call(FERTILITY, farm.ownerId, '/api/fertility/applications', body);
    expect(res.status).toBe(201);
    expect(res.body.taskClose).toEqual({ taskId: t.id, status: 'closed' });
    const after = read(farm, t.id)!;
    expect(after.relatedEventTable).toBe('fertility_application');
    expect(after.relatedEventId).toBe(res.body.application.id);

    const mismatch = task(farm, { blockId: farm.blockId });
    const other = await call(FERTILITY, farm.ownerId, '/api/fertility/applications', {
      ...body,
      blockId: farm.otherBlockId,
      taskId: mismatch.id
    });
    expect(other.status).toBe(201);
    expect(other.body.taskClose.status).toBe('mismatch');
    expect(read(farm, mismatch.id)!.completedAt).toBeUndefined();
  });

  it('another Owner task id saves the record and leaves their task alone', async () => {
    const a = seedFarm('foreign-a');
    const b = seedFarm('foreign-b');
    const theirs = task(b, { blockId: b.blockId });
    const res = await call(SCOUT, a.ownerId, '/api/scout/record', {
      blockId: a.blockId,
      pest: 'note',
      metric: 'note',
      value: 0,
      taskId: theirs.id
    });
    expect(res.status).toBe(201);
    expect(res.body.taskClose.status).toBe('not-found');
    expect(read(b, theirs.id)!.completedAt).toBeUndefined();
  });
});
