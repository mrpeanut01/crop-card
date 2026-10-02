// @vitest-environment node
/**
 * Phase 34A (SO-02, SO-04, SO-11) on a real DB: POST /api/tasks replays a
 * suggestion scheduled offline exactly once, answers a second create for
 * the same `derived:` key with the task the farm already has, still works
 * without a client record id, and rolls back the whole create (no orphan
 * prep or follow-up tasks) when a later step fails.
 */
import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { countTasks, createTask, listTasks } from '$lib/db/tasks';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { POST } from './+server';

const flags = vi.hoisted(() => ({ failMaterialize: false }));

vi.mock('$lib/db/tasks', async (importOriginal) => {
  const real = await importOriginal<typeof import('$lib/db/tasks')>();
  return {
    ...real,
    materializePluginPrePost: (ctx: Parameters<typeof real.materializePluginPrePost>[0]) => {
      if (flags.failMaterialize) {
        real.createTask({
          title: 'Orphan prep',
          kind: 'pre-task',
          linkedToTaskId: ctx.primaryTaskId,
          scheduledFor: ctx.scheduledFor
        });
        throw new Error('materialize failed');
      }
      return real.materializePluginPrePost(ctx);
    }
  };
});

type Role = 'owner' | 'helper' | 'inspector';

function farm(): string {
  const id = `so-${randomUUID().slice(0, 8)}`;
  db.insert(owners)
    .values({ id, name: `Farm ${id}`, slug: id, billingStatus: 'active' })
    .run();
  db.insert(users)
    .values({ id: `user-${id}`, email: `${id}@example.test` })
    .run();
  return id;
}

function body(key = `derived:planting:blk:${Date.now()}${Math.random()}`) {
  return {
    title: 'Plant garlic',
    body: 'Promoted from planting suggestion',
    kind: 'primary' as const,
    scheduledFor: Date.parse('2026-10-05'),
    pluginTemplateKey: key
  };
}

async function post(
  ownerId: string,
  payload: unknown,
  opts: { clientId?: string; role?: Role } = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; body: Record<string, any> }> {
  const url = new URL('http://localhost/api/tasks');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.clientId) headers[CLIENT_RECORD_HEADER] = opts.clientId;
  const event = {
    locals: {
      user: {
        id: `user-${ownerId}`,
        email: null,
        phone: null,
        role: opts.role ?? 'helper',
        activeOwnerId: ownerId,
        isSuperadmin: false,
        impersonating: false
      }
    },
    params: {},
    url,
    request: new Request(url.href, { method: 'POST', headers, body: JSON.stringify(payload) }),
    cookies: { get: () => undefined }
  } as unknown as RequestEvent;
  const res = await runWithTenantAsync(
    ownerId,
    async () => POST(event as never) as Promise<Response>
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

const tasksWithKey = (ownerId: string, key: string) =>
  runWithTenant(ownerId, () =>
    listTasks({ limit: 1000 }).filter((t) => t.pluginTemplateKey === key)
  );

describe('POST /api/tasks replay and suggestion dedupe', () => {
  it('the same client record id twice writes one task', async () => {
    const f = farm();
    const b = body();
    const clientId = randomUUID();
    const first = await post(f, b, { clientId });
    expect(first.status).toBe(201);
    expect(first.body.task).toMatchObject({
      title: 'Plant garlic',
      pluginTemplateKey: b.pluginTemplateKey
    });
    const replay = await post(f, b, { clientId });
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ duplicate: true });
    expect(tasksWithKey(f, b.pluginTemplateKey)).toHaveLength(1);
  });

  it('a second create for a derived key the farm has answers with that task', async () => {
    const f = farm();
    const b = body();
    const first = await post(f, b, { clientId: randomUUID() });
    const again = await post(f, { ...b, title: 'Other title' }, { clientId: randomUUID() });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({
      task: expect.objectContaining({ id: first.body.task.id, title: 'Plant garlic' }),
      materialized: { preTaskIds: [], postTaskIds: [] },
      alreadyScheduled: true
    });
    expect(tasksWithKey(f, b.pluginTemplateKey)).toHaveLength(1);
  });

  it('dedupes against a closed task too, and without a client record id', async () => {
    const f = farm();
    const key = `derived:harvest-window:blk:${randomUUID()}`;
    runWithTenant(f, () =>
      createTask({ title: 'Old', kind: 'primary', scheduledFor: 1, pluginTemplateKey: key })
    );
    const res = await post(f, body(key));
    expect(res.status).toBe(200);
    expect(res.body.alreadyScheduled).toBe(true);
    expect(tasksWithKey(f, key)).toHaveLength(1);
  });

  it('only derived keys dedupe; without a header the create behaves as before', async () => {
    const f = farm();
    const plain = { ...body(), pluginTemplateKey: 'manual:thing' };
    expect((await post(f, plain)).status).toBe(201);
    expect((await post(f, plain)).status).toBe(201);
    expect(tasksWithKey(f, 'manual:thing')).toHaveLength(2);
    const noKey = { title: 'Walk fences', kind: 'primary', scheduledFor: Date.now() };
    const res = await post(f, noKey);
    expect(res.status).toBe(201);
    expect(res.body.alreadyScheduled).toBeUndefined();
  });

  it("another Owner's task with the same key does not count", async () => {
    const a = farm();
    const b = farm();
    const payload = body();
    expect((await post(a, payload)).status).toBe(201);
    expect((await post(b, payload)).status).toBe(201);
    expect(tasksWithKey(a, payload.pluginTemplateKey)).toHaveLength(1);
    expect(tasksWithKey(b, payload.pluginTemplateKey)).toHaveLength(1);
  });

  it('inspectors are refused and nothing is written', async () => {
    const f = farm();
    const b = body();
    const res = await post(f, b, { role: 'inspector', clientId: randomUUID() });
    expect(res.status).toBe(403);
    expect(tasksWithKey(f, b.pluginTemplateKey)).toHaveLength(0);
  });

  it('a failure after the create rolls everything back and a replay then saves once', async () => {
    const f = farm();
    const b = body();
    const clientId = randomUUID();
    const before = runWithTenant(f, () => countTasks());
    flags.failMaterialize = true;
    try {
      await expect(post(f, b, { clientId })).rejects.toThrow('materialize failed');
    } finally {
      flags.failMaterialize = false;
    }
    expect(runWithTenant(f, () => countTasks())).toBe(before);
    const replay = await post(f, b, { clientId });
    expect(replay.status).toBe(201);
    expect(runWithTenant(f, () => countTasks())).toBe(before + 1);
  });
});
